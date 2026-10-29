/**
 * Audio Lab Ingestion & Soundsystem QC - Frontend Client Logic
 * Strict DOM Manipulation (No innerHTML, strictly textContent & createElement)
 */

import {
  initAppHeader,
  apiGet,
  apiPost,
  appendLog,
  renderLogs,
  notify,
  groupFiles,
  groupFilesByFolder,
  createGroupHeaderBar,
  createFileNameCell,
  createGroupCollapseController,
  createQueueMonitor,
  openRenameModal,
  openDeleteModal,
  openFolderInExplorer,
} from './modules/ui-shared.js';

document.addEventListener('DOMContentLoaded', () => {
  // DOM Element References
  const form = document.getElementById('ingestForm');
  const urlInput = document.getElementById('urlInput');
  const optAutoScan = document.getElementById('optAutoScan');
  const optPlaylist = document.getElementById('optPlaylist');
  const optUseCookies = document.getElementById('optUseCookies');
  const optKeepOpus = document.getElementById('optKeepOpus');
  const optRawWebm = document.getElementById('optRawWebm');
  const rawWebmToggleWrap = document.getElementById('rawWebmToggleWrap');
  const keepOpusToggleWrap = document.getElementById('keepOpusToggleWrap');
  const btnStartIngest = document.getElementById('btnStartIngest');

  const systemNoticeCard = document.getElementById('systemNoticeCard');
  const noticeTitle = document.getElementById('noticeTitle');
  const noticeDesc = document.getElementById('noticeDesc');
  const noticeCode = document.getElementById('noticeCode');

  const queueCounter = document.getElementById('queueCounter');
  const jobStatusTag = document.getElementById('jobStatusTag');
  const jobUrlLabel = document.getElementById('jobUrlLabel');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const terminalLogs = document.getElementById('terminalLogs');
  const btnClearLogs = document.getElementById('btnClearLogs');

  const btnRefreshLibrary = document.getElementById('btnRefreshLibrary');
  const btnOpenInboxExplorer = document.getElementById('btnOpenInboxExplorer');
  const btnDeleteSelectedLibrary = document.getElementById('btnDeleteSelectedLibrary');
  const btnDeleteSelectedLibraryText = document.getElementById('btnDeleteSelectedLibraryText');
  const btnResampleMp3 = document.getElementById('btnResampleMp3');
  const btnAuditAll = document.getElementById('btnAuditAll');
  const libraryTableBody = document.getElementById('libraryTableBody');
  const librarySearchInput = document.getElementById('librarySearchInput');
  const libraryGroupBy = document.getElementById('libraryGroupBy');
  const libraryFilterFormat = document.getElementById('libraryFilterFormat');
  const librarySummaryPill = document.getElementById('librarySummaryPill');
  const librarySelectionPill = document.getElementById('librarySelectionPill');
  const btnCollapseAllGroups = document.getElementById('btnCollapseAllGroups');
  const btnExpandAllGroups = document.getElementById('btnExpandAllGroups');
  const btnSelectAllLibrary = document.getElementById('btnSelectAllLibrary');
  const btnClearLibrarySelection = document.getElementById('btnClearLibrarySelection');
  const chkSelectAllLibrary = document.getElementById('chkSelectAllLibrary');

  let allLibraryFiles = [];
  let visibleLibraryFiles = [];
  let currentSourceDir = '';
  const selectedPaths = new Set();
  let lastClickedIndex = null;
  const collapsedGroups = new Set();
  const groupDomMap = new Map();
  const rowElementsByPath = new Map();

  function log(level, message) {
    appendLog(terminalLogs, level, message);
  }

  const groupCollapseCtrl = createGroupCollapseController({
    collapsedGroups,
    groupDomMap,
    btnCollapseAll: btnCollapseAllGroups,
    btnExpandAll: btnExpandAllGroups,
  });

  // 1. Mount Shared Top Header & Check System Dependencies
  initAppHeader({
    activePage: 'ingest',
    onSystemData: (data) => {
      if (!data.yt_dlp || !data.ffmpeg) {
        systemNoticeCard.classList.remove('hidden');
        if (!data.yt_dlp) {
          noticeTitle.textContent = 'yt-dlp Diperlukan untuk Ekstraksi Audio';
          noticeDesc.textContent = 'Pasang yt-dlp pada environment Python Anda dengan perintah berikut:';
          noticeCode.textContent = 'python3 -m pip install -U "yt-dlp[default]"';
        } else if (!data.ffmpeg) {
          noticeTitle.textContent = 'FFmpeg Diperlukan untuk QC True Peak & EBU R128';
          noticeDesc.textContent = 'Pasang FFmpeg agar sistem dapat mengaudit headroom True Peak dan spektrum:';
          noticeCode.textContent = 'sudo apt-get install ffmpeg  # atau download static binary';
        }
      } else {
        systemNoticeCard.classList.add('hidden');
      }
    },
    onSystemError: (err) => {
      log('error', '[SYSTEM] Gagal memverifikasi status backend: ' + err.message);
    },
  });

  // 2. Fetch Queue and Live Logs
  const queueMonitor = createQueueMonitor({
    queueCounter,
    jobStatusTag,
    jobUrlLabel,
    progressFill,
    progressText,
    terminalLogs,
    onActive: () => {
      btnStartIngest.disabled = true;
      btnStartIngest.classList.add('running');
    },
    onTaskFinished: (task) => {
      if (Array.isArray(task.logs) && task.logs.length > 0) {
        renderLogs(terminalLogs, task.logs);
      }
      fetchLibraryFiles();
    },
    onIdle: (justFinished) => {
      btnStartIngest.disabled = false;
      btnStartIngest.classList.remove('running');
      if (justFinished) {
        progressFill.style.width = '100%';
        progressText.textContent = '100% Complete';
        fetchLibraryFiles();
      }
    },
  });

  // 3. Fetch Library Files and Render Grouped QC Table
  async function fetchLibraryFiles() {
    const { ok, data, error } = await apiGet('/api/library');
    if (!ok) {
      log('error', '[LIBRARY] Gagal memuat daftar file: ' + (error || 'Unknown error'));
      return;
    }
    allLibraryFiles = data.files || [];
    currentSourceDir = data.source_dir || '';

    const validSet = new Set(allLibraryFiles.map(f => f.rel_path));
    Array.from(selectedPaths).forEach(p => {
      if (!validSet.has(p)) selectedPaths.delete(p);
    });

    renderLibraryTable();
  }

  function handleRenameFile(fileObj) {
    openRenameModal({
      title: 'Ubah Nama File Audio',
      oldName: fileObj.name,
      isFolder: false,
      onSave: async (newName) => {
        const { ok, data, error } = await apiPost('/api/rename', {
          source_dir: currentSourceDir,
          rel_path: fileObj.rel_path,
          new_name: newName,
          is_folder: false,
        });
        if (!ok) {
          throw new Error(error || 'Gagal mengubah nama file.');
        }
        notify({
          type: 'success',
          title: 'File Berhasil Diubah',
          message: `Nama file diubah menjadi: ${data?.new_name || newName}`,
          duration: 3500,
        });
        await fetchLibraryFiles();
      },
    });
  }

  function handleRenameFolder(group) {
    openRenameModal({
      title: 'Ubah Nama Folder Playlist',
      oldName: group.key.split('/').pop(),
      isFolder: true,
      onSave: async (newName) => {
        const { ok, data, error } = await apiPost('/api/rename', {
          source_dir: currentSourceDir,
          rel_path: group.key,
          new_name: newName,
          is_folder: true,
        });
        if (!ok) {
          throw new Error(error || 'Gagal mengubah nama folder.');
        }
        notify({
          type: 'success',
          title: 'Folder Berhasil Diubah',
          message: `Nama folder diubah menjadi: ${data?.new_name || newName}`,
          duration: 3500,
        });
        await fetchLibraryFiles();
      },
    });
  }

  function handleDeleteFile(fileObj) {
    openDeleteModal({
      title: 'Hapus File Audio',
      message: 'Apakah Anda yakin ingin menghapus file audio ini secara permanen dari disk?',
      items: [fileObj.rel_path || fileObj.name],
      confirmLabel: 'Hapus File',
      onConfirm: async () => {
        const { ok, data, error } = await apiPost('/api/delete', {
          source_dir: currentSourceDir,
          rel_path: fileObj.rel_path,
          is_folder: false,
        });
        if (!ok) {
          throw new Error(error || 'Gagal menghapus file audio.');
        }
        selectedPaths.delete(fileObj.rel_path);
        log('warn', '[DELETE] ' + (data?.message || `File dihapus: ${fileObj.name}`));
        notify({
          type: 'info',
          title: 'File Audio Dihapus',
          message: data?.message || `File "${fileObj.name}" berhasil dihapus.`,
          duration: 3500,
        });
        await fetchLibraryFiles();
      },
    });
  }

  function handleDeleteFolder(group) {
    openDeleteModal({
      title: 'Hapus Folder Playlist',
      message: `Seluruh folder playlist "${group.label}" beserta ${group.files.length} file audio (${group.totalSizeMb} MB) di dalamnya akan dihapus permanen:`,
      items: [`📁 ${group.label} (${group.files.length} lagu • ${group.totalSizeMb} MB)`],
      confirmLabel: 'Hapus Folder & Lagu',
      onConfirm: async () => {
        const { ok, data, error } = await apiPost('/api/delete', {
          source_dir: currentSourceDir,
          rel_path: group.key,
          is_folder: true,
        });
        if (!ok) {
          throw new Error(error || 'Gagal menghapus folder playlist.');
        }
        group.files.forEach(f => selectedPaths.delete(f.rel_path));
        log('warn', '[DELETE FOLDER] ' + (data?.message || `Folder dihapus: ${group.label}`));
        notify({
          type: 'info',
          title: 'Folder Playlist Dihapus',
          message: data?.message || `Folder "${group.label}" berhasil dihapus.`,
          duration: 3800,
        });
        await fetchLibraryFiles();
      },
    });
  }

  function handleDeleteGroupFiles(group) {
    const relPaths = group.files.map(f => f.rel_path);
    if (relPaths.length === 0) return;
    openDeleteModal({
      title: `Hapus Grup: ${group.label}`,
      message: `Sebanyak ${relPaths.length} file audio (${group.totalSizeMb} MB) dalam grup "${group.label}" akan dihapus permanen:`,
      items: relPaths,
      confirmLabel: `Hapus ${relPaths.length} File`,
      onConfirm: async () => {
        const { ok, data, error } = await apiPost('/api/delete', {
          source_dir: currentSourceDir,
          rel_paths: relPaths,
          is_folder: false,
        });
        if (!ok) {
          throw new Error(error || 'Gagal menghapus file dalam grup.');
        }
        relPaths.forEach(rp => selectedPaths.delete(rp));
        lastClickedIndex = null;
        log('warn', '[DELETE GROUP] ' + (data?.message || `${relPaths.length} file dihapus.`));
        notify({
          type: 'info',
          title: 'Grup File Dihapus',
          message: data?.message || `Berhasil menghapus ${relPaths.length} file dari grup "${group.label}".`,
          duration: 3800,
        });
        await fetchLibraryFiles();
      },
    });
  }

  function handleBatchDeleteSelected() {
    if (selectedPaths.size === 0) return;
    const relPaths = Array.from(selectedPaths);
    openDeleteModal({
      title: `Hapus Batch (${relPaths.length} Lagu Terpilih)`,
      message: `Sebanyak ${relPaths.length} file audio yang dicentang akan dihapus permanen dari disk:`,
      items: relPaths,
      confirmLabel: `Hapus ${relPaths.length} Lagu`,
      onConfirm: async () => {
        const { ok, data, error } = await apiPost('/api/delete', {
          source_dir: currentSourceDir,
          rel_paths: relPaths,
          is_folder: false,
        });
        if (!ok) {
          throw new Error(error || 'Gagal menghapus lagu terpilih.');
        }
        selectedPaths.clear();
        lastClickedIndex = null;
        log('warn', '[BATCH DELETE] ' + (data?.message || `${relPaths.length} file dihapus.`));
        notify({
          type: 'info',
          title: 'Batch Delete Selesai',
          message: data?.message || `Berhasil menghapus ${relPaths.length} file audio.`,
          duration: 4000,
        });
        await fetchLibraryFiles();
      },
    });
  }

  function syncLibrarySelectionDOM() {
    rowElementsByPath.forEach(({ tr, chk }, relPath) => {
      const isSelected = selectedPaths.has(relPath);
      chk.checked = isSelected;
      tr.classList.toggle('row-selected', isSelected);
    });

    groupDomMap.forEach(({ groupChk, filePaths }) => {
      if (!groupChk || !filePaths || filePaths.length === 0) return;
      const selCount = filePaths.filter(rp => selectedPaths.has(rp)).length;
      groupChk.checked = selCount === filePaths.length;
      groupChk.indeterminate = selCount > 0 && selCount < filePaths.length;
    });

    if (chkSelectAllLibrary) {
      if (visibleLibraryFiles.length === 0) {
        chkSelectAllLibrary.checked = false;
        chkSelectAllLibrary.indeterminate = false;
      } else {
        const visSelected = visibleLibraryFiles.filter(f => selectedPaths.has(f.rel_path)).length;
        chkSelectAllLibrary.checked = visSelected === visibleLibraryFiles.length;
        chkSelectAllLibrary.indeterminate = visSelected > 0 && visSelected < visibleLibraryFiles.length;
      }
    }

    const count = selectedPaths.size;
    if (librarySelectionPill) {
      librarySelectionPill.textContent = `${count} dipilih`;
    }
    if (btnDeleteSelectedLibraryText) {
      btnDeleteSelectedLibraryText.textContent = `Hapus Terpilih (${count})`;
    }
    if (btnDeleteSelectedLibrary) {
      btnDeleteSelectedLibrary.disabled = count === 0;
    }
  }

  function handleLibraryRowSelect(idx, relPath, checked, isShift) {
    if (isShift && lastClickedIndex !== null && lastClickedIndex !== idx) {
      const start = Math.min(lastClickedIndex, idx);
      const end = Math.max(lastClickedIndex, idx);
      for (let i = start; i <= end; i++) {
        const item = visibleLibraryFiles[i];
        if (item) {
          if (checked) selectedPaths.add(item.rel_path);
          else selectedPaths.delete(item.rel_path);
        }
      }
    } else {
      if (checked) selectedPaths.add(relPath);
      else selectedPaths.delete(relPath);
    }
    lastClickedIndex = idx;
    syncLibrarySelectionDOM();
  }

  function renderLibraryTable() {
    libraryTableBody.replaceChildren();
    groupDomMap.clear();
    rowElementsByPath.clear();

    const query = (librarySearchInput ? librarySearchInput.value : '').trim().toLowerCase();
    const fmtFilter = libraryFilterFormat ? libraryFilterFormat.value : 'ALL';
    const groupByMode = libraryGroupBy ? libraryGroupBy.value : 'folder';

    const filtered = allLibraryFiles.filter(f => {
      if (fmtFilter !== 'ALL' && f.ext !== fmtFilter) {
        return false;
      }
      if (query) {
        const matchName = f.name.toLowerCase().includes(query);
        const matchFolder = (f.folder || '').toLowerCase().includes(query);
        const matchExt = (f.ext || '').toLowerCase().includes(query);
        if (!matchName && !matchFolder && !matchExt) return false;
      }
      return true;
    });

    visibleLibraryFiles = filtered;
    const groups = groupFiles(filtered, groupByMode);
    if (librarySummaryPill) {
      librarySummaryPill.textContent = `${filtered.length} lagu • ${groups.length} grup`;
    }

    if (filtered.length === 0) {
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      const td = document.createElement('td');
      td.setAttribute('colspan', '9');
      td.textContent = allLibraryFiles.length === 0
        ? 'Belum ada file audio di library/inbox. Masukkan URL YouTube di atas untuk memulai.'
        : 'Tidak ada lagu atau tipe file yang cocok dengan filter saat ini.';
      tr.appendChild(td);
      libraryTableBody.appendChild(tr);
      syncLibrarySelectionDOM();
      return;
    }

    const fragment = document.createDocumentFragment();
    let flatIdx = 0;

    groups.forEach(group => {
      const isCollapsed = collapsedGroups.has(group.key);
      const groupFilePaths = group.files.map(f => f.rel_path);

      // Group Header Row with Group Select Checkbox
      const headerTr = document.createElement('tr');
      headerTr.className = 'group-header-row';

      const tdGroupCheck = document.createElement('td');
      tdGroupCheck.className = 'col-check';
      const groupChk = document.createElement('input');
      groupChk.type = 'checkbox';
      groupChk.title = `Pilih semua lagu di grup "${group.label}"`;
      groupChk.setAttribute('aria-label', `Pilih semua lagu di grup ${group.label}`);
      groupChk.addEventListener('click', (e) => {
        e.stopPropagation();
        const checkAll = groupChk.checked;
        groupFilePaths.forEach(rp => {
          if (checkAll) selectedPaths.add(rp);
          else selectedPaths.delete(rp);
        });
        syncLibrarySelectionDOM();
      });
      tdGroupCheck.appendChild(groupChk);
      headerTr.appendChild(tdGroupCheck);

      const headerTd = document.createElement('td');
      headerTd.setAttribute('colspan', '8');

      const { bar, chevron, toggleHint } = createGroupHeaderBar(group, isCollapsed, {
        onOpenExplorer: (g) => {
          openFolderInExplorer(g.isRoot ? '' : (g.folderPath || g.key), currentSourceDir);
        },
        onRenameFolder: (g) => {
          handleRenameFolder(g);
        },
        onDeleteFolder: (g) => {
          handleDeleteFolder(g);
        },
        onDeleteGroupFiles: (g) => {
          handleDeleteGroupFiles(g);
        },
      });
      headerTd.appendChild(bar);
      headerTr.appendChild(headerTd);

      headerTr.addEventListener('click', () => {
        groupCollapseCtrl.toggleGroup(group.key);
      });

      fragment.appendChild(headerTr);

      const childRows = [];
      const showRowFolder = groupByMode === 'type' || groupByMode === 'rate';

      group.files.forEach((f, idx) => {
        const currentFlatIdx = flatIdx++;
        const tr = document.createElement('tr');
        const isSelected = selectedPaths.has(f.rel_path);
        if (isSelected) tr.classList.add('row-selected');
        if (isCollapsed) tr.classList.add('group-row-hidden');

        // Checkbox cell
        const tdCheck = document.createElement('td');
        tdCheck.className = 'col-check';
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = isSelected;
        chk.setAttribute('aria-label', 'Pilih ' + f.name);
        chk.addEventListener('click', (e) => {
          e.stopPropagation();
          handleLibraryRowSelect(currentFlatIdx, f.rel_path, chk.checked, e.shiftKey);
        });
        tdCheck.appendChild(chk);
        tr.appendChild(tdCheck);

        tr.addEventListener('click', (e) => {
          const newChecked = !selectedPaths.has(f.rel_path);
          handleLibraryRowSelect(currentFlatIdx, f.rel_path, newChecked, e.shiftKey);
        });

        rowElementsByPath.set(f.rel_path, { tr, chk });

        tr.appendChild(
          createFileNameCell(f, {
            index: idx + 1,
            showFolderBadge: showRowFolder,
            onRename: (fileObj) => {
              handleRenameFile(fileObj);
            },
            onDelete: (fileObj) => {
              handleDeleteFile(fileObj);
            },
          })
        );

        // Size
        const tdSize = document.createElement('td');
        tdSize.className = 'mono-cell';
        tdSize.textContent = f.size_mb + ' MB';
        tr.appendChild(tdSize);

        const qc = f.qc || {};

        // Codec
        const tdCodec = document.createElement('td');
        tdCodec.className = 'mono-cell';
        tdCodec.textContent = qc.codec || 'native stream';
        tr.appendChild(tdCodec);

        // Sample rate
        const tdRate = document.createElement('td');
        tdRate.className = 'mono-cell';
        tdRate.textContent = qc.sample_rate_hz ? qc.sample_rate_hz + ' Hz' : '-';
        tr.appendChild(tdRate);

        // True Peak
        const tdPeak = document.createElement('td');
        tdPeak.className = 'mono-cell';
        if (qc.true_peak_dbtp !== undefined && qc.true_peak_dbtp !== '') {
          tdPeak.textContent = qc.true_peak_dbtp + ' dBTP';
        } else {
          tdPeak.textContent = 'Not Scanned';
        }
        tr.appendChild(tdPeak);

        // Integrated LUFS
        const tdLufs = document.createElement('td');
        tdLufs.className = 'mono-cell';
        tdLufs.textContent = qc.integrated_lufs ? qc.integrated_lufs + ' LUFS' : '-';
        tr.appendChild(tdLufs);

        // LRA
        const tdLra = document.createElement('td');
        tdLra.className = 'mono-cell';
        tdLra.textContent = qc.lra_lu ? qc.lra_lu + ' LU' : '-';
        tr.appendChild(tdLra);

        // Soundsystem Status Badge
        const tdStatus = document.createElement('td');
        const badge = document.createElement('span');

        if (qc.true_peak_dbtp !== undefined && qc.true_peak_dbtp !== '') {
          const tp = parseFloat(qc.true_peak_dbtp);
          if (tp > 0) {
            badge.className = 'badge-danger';
            badge.textContent = 'CLIPPING HAZARD';
            badge.title = 'True peak > 0 dBTP. Sinyal berisiko distorsi inter-sample DAC di amplifier besar.';
          } else if (tp > -1.0) {
            badge.className = 'badge-warning';
            badge.textContent = 'TRIM PREAMP (-2dB)';
            badge.title = 'True peak antara -1 s/d 0 dBTP. Turunkan fader input sedikit untuk headroom.';
          } else {
            badge.className = 'badge-safe';
            badge.textContent = 'READY FOR FOH';
            badge.title = 'Headroom aman untuk sistem tata suara skala besar.';
          }
        } else {
          badge.className = 'badge-untested';
          badge.textContent = 'BELUM DI-AUDIT';
        }

        tdStatus.appendChild(badge);
        tr.appendChild(tdStatus);
        fragment.appendChild(tr);
        childRows.push(tr);
      });

      groupDomMap.set(group.key, {
        childRows,
        chevron,
        toggleHint,
        groupChk,
        filePaths: groupFilePaths,
      });
    });

    libraryTableBody.appendChild(fragment);
    syncLibrarySelectionDOM();
  }

  if (librarySearchInput) {
    librarySearchInput.addEventListener('input', renderLibraryTable);
  }
  if (libraryGroupBy) {
    libraryGroupBy.addEventListener('change', () => {
      collapsedGroups.clear();
      renderLibraryTable();
    });
  }
  if (libraryFilterFormat) {
    libraryFilterFormat.addEventListener('change', renderLibraryTable);
  }

  if (chkSelectAllLibrary) {
    chkSelectAllLibrary.addEventListener('change', () => {
      const check = chkSelectAllLibrary.checked;
      visibleLibraryFiles.forEach(f => {
        if (check) selectedPaths.add(f.rel_path);
        else selectedPaths.delete(f.rel_path);
      });
      syncLibrarySelectionDOM();
    });
  }

  if (btnSelectAllLibrary) {
    btnSelectAllLibrary.addEventListener('click', () => {
      visibleLibraryFiles.forEach(f => selectedPaths.add(f.rel_path));
      syncLibrarySelectionDOM();
    });
  }

  if (btnClearLibrarySelection) {
    btnClearLibrarySelection.addEventListener('click', () => {
      selectedPaths.clear();
      lastClickedIndex = null;
      syncLibrarySelectionDOM();
    });
  }

  if (btnDeleteSelectedLibrary) {
    btnDeleteSelectedLibrary.addEventListener('click', () => {
      handleBatchDeleteSelected();
    });
  }

  // Format radio change listeners
  const specText = document.getElementById('specText');
  const specDot = document.getElementById('specDot');
  const formatRadios = document.querySelectorAll('input[name="audioFormat"]');
  if (specDot) specDot.style.backgroundColor = '#10b981';

  function updateFormatSpecBanner() {
    const val = document.querySelector('input[name="audioFormat"]:checked')?.value || 'opus';
    const keepOpus = optKeepOpus ? optKeepOpus.checked : false;
    const isRawWebm = optRawWebm ? optRawWebm.checked : false;

    if (rawWebmToggleWrap) {
      rawWebmToggleWrap.style.display = val === 'opus' ? 'flex' : 'none';
    }
    if (keepOpusToggleWrap) {
      keepOpusToggleWrap.style.display = val.startsWith('mp3') ? 'flex' : 'none';
    }

    if (val === 'opus') {
      if (isRawWebm) {
        if (specText) specText.textContent = 'Target: Native Raw Stream — Format mentah asli YouTube (.webm / .m4a) tanpa remux';
        if (specDot) specDot.style.backgroundColor = 'var(--accent-cyan)';
      } else {
        if (specText) specText.textContent = 'Target: Opus Best Quality (.opus) — Lossless Remux 48 kHz + Metadata Tag';
        if (specDot) specDot.style.backgroundColor = '#10b981';
      }
    } else if (val === 'mp3_320k') {
      const opusSuffix = keepOpus ? ' + Simpan File Asli Opus (.webm)' : '';
      if (specText) specText.textContent = 'Target: MP3 320 kbps CBR' + opusSuffix + ' (KONVERSI lossy)';
      if (specDot) specDot.style.backgroundColor = 'var(--accent-amber)';
    } else if (val === 'mp3_vbr0') {
      const opusSuffix = keepOpus ? ' + Simpan File Asli Opus (.webm)' : '';
      if (specText) specText.textContent = 'Target: MP3 VBR 0' + opusSuffix + ' (KONVERSI lossy)';
      if (specDot) specDot.style.backgroundColor = '#c084fc';
    }
  }

  formatRadios.forEach(radio => {
    radio.addEventListener('change', updateFormatSpecBanner);
  });

  if (optKeepOpus) {
    optKeepOpus.addEventListener('change', updateFormatSpecBanner);
  }

  if (optRawWebm) {
    optRawWebm.addEventListener('change', updateFormatSpecBanner);
  }

  updateFormatSpecBanner();

  // 4. Submit Batch Ingestion Form
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawVal = urlInput.value.trim();
    if (!rawVal) return;

    const urls = rawVal.split('\n').map(l => l.trim()).filter(Boolean);
    const autoScan = optAutoScan ? optAutoScan.checked : true;
    const isPlaylist = optPlaylist ? optPlaylist.checked : false;
    const useCookies = optUseCookies ? optUseCookies.checked : true;
    const keepOpus = optKeepOpus ? optKeepOpus.checked : false;
    const selectedFormat = document.querySelector('input[name="audioFormat"]:checked')?.value || 'opus';
    const isRawWebm = optRawWebm ? optRawWebm.checked : false;
    const effectiveFormat = (selectedFormat === 'opus' && isRawWebm) ? 'native' : selectedFormat;

    btnStartIngest.disabled = true;
    const opusLog = (effectiveFormat.startsWith('mp3') && keepOpus) ? ' + Opus (.webm)' : '';
    log('info', `[DISPATCH] Mengirim ${urls.length} item ke antrian unduhan (${effectiveFormat}${opusLog})...`);

    const { ok, data, error } = await apiPost('/api/download', {
      urls,
      auto_scan: autoScan,
      is_playlist: isPlaylist,
      audio_format: effectiveFormat,
      keep_opus: keepOpus,
      use_cookies: useCookies,
      cookie_browser: 'chrome',
    });

    if (ok) {
      log('info', '[DISPATCH] ' + data.message);
      const hasSkippedUrls = (data.duplicate_count || 0) > 0 || (data.invalid_count || 0) > 0;
      notify({
        type: hasSkippedUrls ? 'warning' : 'info',
        title: hasSkippedUrls ? 'Antrian Ditambahkan (Dengan Catatan)' : 'Masuk Antrian Unduhan',
        message: data.message,
      });
      urlInput.value = '';
      queueMonitor.poll();
    } else {
      const errMsg = error || 'Gagal menambahkan tugas.';
      log('error', '[DISPATCH ERROR] ' + errMsg);
      notify({
        type: data.duplicate_count > 0 ? 'exists' : 'error',
        title: data.duplicate_count > 0 ? 'URL Sudah Dalam Antrian' : 'Gagal Menambahkan Unduhan',
        message: errMsg,
        playSound: true,
      });
      btnStartIngest.disabled = false;
    }
  });

  // 5. Actions: Refresh, Resample & Full Audit
  async function triggerResample(relPath, onlyMp3) {
    const { ok, data, error } = await apiPost('/api/resample', {
      rel_path: relPath || null,
      target_rate: 44100,
      only_mp3: Boolean(onlyMp3),
    });

    if (ok) {
      log('info', '[RESAMPLE] ' + data.message);
      notify({
        type: 'info',
        title: 'Konversi Dijadwalkan',
        message: data.message,
      });
      queueMonitor.poll();
    } else {
      const errMsg = error || 'Gagal menjadwalkan konversi sample rate.';
      log('error', '[RESAMPLE ERROR] ' + errMsg);
      notify({
        type: 'error',
        title: 'Gagal Menjadwalkan Konversi',
        message: errMsg,
        playSound: true,
      });
    }
  }

  if (btnOpenInboxExplorer) {
    btnOpenInboxExplorer.addEventListener('click', () => {
      openFolderInExplorer('', currentSourceDir);
    });
  }

  btnRefreshLibrary.addEventListener('click', async () => {
    await fetchLibraryFiles();
    notify({
      type: 'info',
      title: 'Library Diperbarui',
      message: `Memuat ${allLibraryFiles.length} lagu dari Inbox.`,
      duration: 3000,
      recordHistory: false,
    });
  });

  if (btnResampleMp3) {
    btnResampleMp3.addEventListener('click', () => {
      triggerResample(null, true);
    });
  }

  btnAuditAll.addEventListener('click', async () => {
    btnAuditAll.disabled = true;
    log('info', '[AUDIT] Memulai audit audio QC menyeluruh (EBU R128 & True Peak)...');
    notify({
      type: 'info',
      title: 'Memulai Full QC Audit',
      message: 'Memindai EBU R128 LUFS & True Peak untuk seluruh lagu di Inbox...',
      recordHistory: false,
    });
    try {
      const { ok, data, error } = await apiPost('/api/scan');
      if (ok) {
        const results = data.results || [];
        let clipCount = 0;
        let trimCount = 0;
        results.forEach(r => {
          const tp = parseFloat(r.true_peak_dbtp);
          if (!Number.isNaN(tp)) {
            if (tp > 0) clipCount += 1;
            else if (tp > -1.0) trimCount += 1;
          }
        });
        log('info', `[AUDIT] Selesai. ${results.length} file berhasil diukur.`);
        if (results.length === 0) {
          notify({
            type: 'warning',
            title: 'Inbox Kosong',
            message: 'Tidak ada file audio di Inbox untuk diaudit.',
            playSound: true,
          });
        } else if (clipCount > 0) {
          notify({
            type: 'warning',
            title: 'Audit QC Selesai (Clipping Hazard)',
            message: `${results.length} lagu diaudit: ⚠️ ${clipCount} lagu berisiko Clipping (> 0 dBTP) dan ${trimCount} lagu perlu Trim Preamp.`,
            playSound: true,
          });
        } else {
          notify({
            type: 'success',
            title: 'Audit QC Selesai',
            message: `${results.length} lagu berhasil diaudit (${trimCount > 0 ? trimCount + ' perlu Trim Preamp, ' : ''}0 Clipping Hazard).`,
            playSound: true,
          });
        }
        fetchLibraryFiles();
      } else {
        const errMsg = error || 'Audit gagal.';
        log('error', '[AUDIT ERROR] ' + errMsg);
        notify({
          type: 'error',
          title: 'Audit QC Gagal',
          message: errMsg,
          playSound: true,
        });
      }
    } finally {
      btnAuditAll.disabled = false;
    }
  });

  btnClearLogs.addEventListener('click', () => {
    terminalLogs.replaceChildren();
  });

  // Start polling
  queueMonitor.poll();
  fetchLibraryFiles();

  setInterval(() => {
    queueMonitor.poll();
  }, 2000);
});
