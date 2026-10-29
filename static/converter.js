/**
 * Audio Lab - Sample Rate & Batch Playlist Converter Client Logic
 * Strict DOM Manipulation (No innerHTML, strictly textContent & createElement)
 */

import {
  initAppHeader,
  apiGet,
  apiPost,
  appendLog,
  renderLogs,
  notify,
  groupFilesByFolder,
  createGroupHeaderBar,
  createFileNameCell,
  createGroupCollapseController,
  createQueueMonitor,
  openRenameModal,
  openDeleteModal,
  openFolderInExplorer,
} from './modules/ui-shared.js';
import { initFolderModal } from './modules/folder-modal.js';

document.addEventListener('DOMContentLoaded', () => {
  const playlistGrid = document.getElementById('playlistGrid');
  const probeStatusHint = document.getElementById('probeStatusHint');
  const activePlaylistSummary = document.getElementById('activePlaylistSummary');
  const btnConvertPlaylist = document.getElementById('btnConvertPlaylist');
  const btnConvertPlaylistText = document.getElementById('btnConvertPlaylistText');

  const optOnlyMp3 = document.getElementById('optOnlyMp3');
  const optOverwrite = document.getElementById('optOverwrite');
  const convertModeRadios = document.querySelectorAll('input[name="convertMode"]');
  const targetRateRadios = document.querySelectorAll('input[name="targetRate"]');
  const targetBitrateRadios = document.querySelectorAll('input[name="targetBitrate"]');
  const resampleRateGroup = document.getElementById('resampleRateGroup');
  const resampleBitrateGroup = document.getElementById('resampleBitrateGroup');
  const onlyMp3ToggleWrap = document.getElementById('onlyMp3ToggleWrap');
  const overwriteHintText = document.getElementById('overwriteHintText');

  const queueCounter = document.getElementById('queueCounter');
  const jobStatusTag = document.getElementById('jobStatusTag');
  const jobUrlLabel = document.getElementById('jobUrlLabel');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const terminalLogs = document.getElementById('terminalLogs');
  const btnClearLogs = document.getElementById('btnClearLogs');

  const btnProbeCurrent = document.getElementById('btnProbeCurrent');
  const btnOpenSourceExplorer = document.getElementById('btnOpenSourceExplorer');
  const btnDeleteSelected = document.getElementById('btnDeleteSelected');
  const btnDeleteSelectedText = document.getElementById('btnDeleteSelectedText');
  const btnConvertSelected = document.getElementById('btnConvertSelected');
  const btnConvertSelectedText = document.getElementById('btnConvertSelectedText');

  const searchInput = document.getElementById('searchInput');
  const filterFormat = document.getElementById('filterFormat');
  const filterRate = document.getElementById('filterRate');
  const filterBitrate = document.getElementById('filterBitrate');

  const selectionCounterPill = document.getElementById('selectionCounterPill');
  const btnCollapseAllGroups = document.getElementById('btnCollapseAllGroups');
  const btnExpandAllGroups = document.getElementById('btnExpandAllGroups');
  const btnSelectNeedConvert = document.getElementById('btnSelectNeedConvert');
  const btnSelectVisible = document.getElementById('btnSelectVisible');
  const btnClearSelection = document.getElementById('btnClearSelection');

  const chkSelectAllVisible = document.getElementById('chkSelectAllVisible');
  const converterTableBody = document.getElementById('converterTableBody');

  // Source & Destination Folder controls
  const sourceDirInput = document.getElementById('sourceDirInput');
  const btnBrowseSource = document.getElementById('btnBrowseSource');
  const btnLoadSource = document.getElementById('btnLoadSource');
  const destDirInput = document.getElementById('destDirInput');
  const btnBrowseDest = document.getElementById('btnBrowseDest');
  const btnClearDest = document.getElementById('btnClearDest');

  // State
  let allFiles = [];
  let allPlaylists = [];
  let activePlaylist = 'ALL'; // 'ALL', '__ROOT__', or folder name
  const selectedPaths = new Set();
  let visibleFiles = [];
  let lastClickedIndex = null;
  const probedFolders = new Set();
  let currentSourceDir = '';
  const collapsedGroups = new Set();

  // Map of rel_path -> { tr: HTMLTableRowElement, chk: HTMLInputElement } for O(1) DOM selection updates
  const rowElementsByPath = new Map();
  // Map of groupKey -> { childRows: HTMLTableRowElement[], chevron: HTMLElement, toggleHint: HTMLElement, groupChk: HTMLInputElement, filePaths: string[] }
  const groupDomMap = new Map();

  function log(level, message) {
    appendLog(terminalLogs, level, message);
  }

  const groupCollapseCtrl = createGroupCollapseController({
    collapsedGroups,
    groupDomMap,
    btnCollapseAll: btnCollapseAllGroups,
    btnExpandAll: btnExpandAllGroups,
  });

  function getConvertMode() {
    const checked = document.querySelector('input[name="convertMode"]:checked');
    return checked ? checked.value : 'resample';
  }

  function getTargetRate() {
    const checked = document.querySelector('input[name="targetRate"]:checked');
    return checked ? parseInt(checked.value, 10) : 44100;
  }

  function getTargetBitrate() {
    const checked = document.querySelector('input[name="targetBitrate"]:checked');
    return checked ? parseInt(checked.value, 10) : 320;
  }

  function isAlreadyMatching(fileObj, targetRate, targetBitrate) {
    if (getConvertMode() === 'remux_opus') {
      return fileObj.ext !== '.webm' && fileObj.ext !== '.ogg';
    }
    const qc = fileObj.qc || {};
    const sr = qc.sample_rate_hz ? parseInt(qc.sample_rate_hz, 10) : 0;
    const br = qc.bitrate_kbps ? parseFloat(qc.bitrate_kbps) : 0;
    const rateMatch = sr === targetRate;
    const brMatch = fileObj.ext === '.mp3' && br > 0 && Math.abs(br - targetBitrate) <= 8;
    return rateMatch && brMatch;
  }

  function syncConvertModeUI() {
    const isRemux = getConvertMode() === 'remux_opus';
    if (resampleRateGroup) resampleRateGroup.style.display = isRemux ? 'none' : '';
    if (resampleBitrateGroup) resampleBitrateGroup.style.display = isRemux ? 'none' : '';
    if (onlyMp3ToggleWrap) onlyMp3ToggleWrap.style.display = isRemux ? 'none' : '';
    if (overwriteHintText) {
      overwriteHintText.textContent = isRemux
        ? 'Jika aktif: file .webm asli langsung diganti menjadi .opus di folder yang sama. Jika nonaktif: disimpan ke folder baru "[Nama Playlist] [Opus]".'
        : 'Default (Nonaktif): File asli TIDAK ditimpa. Hasil konversi disimpan ke folder baru "[Nama Playlist] [44.1kHz]"';
    }
  }

  // 1. Mount Shared Top Header & System status check
  initAppHeader({ activePage: 'converter' });

  // 2. Fetch library and playlists
  async function fetchLibrary(customSource) {
    const targetSource = typeof customSource === 'string' ? customSource.trim() : currentSourceDir;
    const url = targetSource
      ? '/api/library?source_dir=' + encodeURIComponent(targetSource)
      : '/api/library';
    const { ok, data, error } = await apiGet(url);
    if (!ok) {
      const errMsg = error || 'Gagal memuat folder sumber.';
      log('error', '[LIBRARY] ' + errMsg);
      notify({
        type: 'error',
        title: 'Gagal Memuat Folder Sumber',
        message: errMsg,
        playSound: true,
      });
      return false;
    }
    if (data.source_dir) {
      currentSourceDir = data.source_dir;
      if (sourceDirInput) sourceDirInput.value = data.source_dir;
    }
    allFiles = data.files || [];
    allPlaylists = data.playlists || [];

    // Remove any selected paths that no longer exist
    const validSet = new Set(allFiles.map(f => f.rel_path));
    Array.from(selectedPaths).forEach(p => {
      if (!validSet.has(p)) selectedPaths.delete(p);
    });

    renderPlaylists();
    applyFiltersAndRenderTable();
    updateSelectionUI();
    return true;
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
        await fetchLibrary();
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
        if (activePlaylist === group.key) {
          activePlaylist = data?.rel_path || 'ALL';
        }
        await fetchLibrary();
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
        await fetchLibrary();
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
        if (activePlaylist === group.key) {
          activePlaylist = 'ALL';
        }
        log('warn', '[DELETE FOLDER] ' + (data?.message || `Folder dihapus: ${group.label}`));
        notify({
          type: 'info',
          title: 'Folder Playlist Dihapus',
          message: data?.message || `Folder "${group.label}" berhasil dihapus.`,
          duration: 3800,
        });
        await fetchLibrary();
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
        await fetchLibrary();
      },
    });
  }

  // 3. Fast ffprobe scan for a playlist folder
  async function probeFolder(folderName, isManual = false) {
    if (probeStatusHint) {
      probeStatusHint.textContent = 'Memindai sample rate lagu dengan ffprobe...';
    }
    if (btnProbeCurrent) btnProbeCurrent.disabled = true;
    try {
      const payload = folderName === 'ALL' ? {} : { folder: folderName };
      if (currentSourceDir) payload.source_dir = currentSourceDir;
      const { ok, data, error } = await apiPost('/api/probe', payload);
      if (ok) {
        allFiles = data.files || [];
        allPlaylists = data.playlists || [];
        probedFolders.add(currentSourceDir + '::' + folderName);
        renderPlaylists();
        applyFiltersAndRenderTable();
        updateSelectionUI();
        if (isManual) {
          notify({
            type: 'success',
            title: 'Metadata Sample Rate Diperbarui',
            message: `Berhasil membaca sample rate & bitrate pada ${visibleFiles.length} lagu.`,
            duration: 3800,
          });
        }
      } else {
        const errMsg = error || 'Terjadi kesalahan saat menjalankan ffprobe.';
        log('error', '[PROBE] Gagal membaca metadata: ' + errMsg);
        if (isManual) {
          notify({
            type: 'error',
            title: 'Gagal Memindai Sample Rate',
            message: errMsg,
            playSound: true,
          });
        }
      }
    } finally {
      if (probeStatusHint) {
        probeStatusHint.textContent = 'Klik playlist untuk memfilter & membaca sample rate lagu';
      }
      if (btnProbeCurrent) btnProbeCurrent.disabled = false;
    }
  }

  // 4. Render Playlist Selector Cards
  function renderPlaylists() {
    playlistGrid.replaceChildren();

    const totalSongs = allFiles.length;
    const totalMp3 = allFiles.filter(f => f.ext === '.mp3').length;

    const fragment = document.createDocumentFragment();
    fragment.appendChild(
      createPlaylistCard('ALL', 'Semua Koleksi (Inbox)', totalSongs + ' lagu total', totalMp3 + ' MP3')
    );

    allPlaylists.forEach(pl => {
      const displayLabel = pl.label || ('📁 ' + pl.name);
      const subText = pl.total + ' lagu';
      const badgeText = pl.mp3_count > 0 ? (pl.mp3_count + ' MP3') : (pl.other_count + ' Native');
      fragment.appendChild(createPlaylistCard(pl.name, displayLabel, subText, badgeText));
    });

    playlistGrid.appendChild(fragment);
    updatePlaylistSummaryText();
  }

  function createPlaylistCard(id, title, countText, badgeText) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'playlist-card' + (activePlaylist === id ? ' active' : '');

    const topRow = document.createElement('div');
    topRow.className = 'playlist-card-top';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'playlist-card-title';
    nameSpan.textContent = title;
    nameSpan.title = title;
    topRow.appendChild(nameSpan);

    const badgeSpan = document.createElement('span');
    badgeSpan.className = 'playlist-card-badge';
    badgeSpan.textContent = badgeText;
    topRow.appendChild(badgeSpan);

    const bottomRow = document.createElement('div');
    bottomRow.className = 'playlist-card-sub';
    bottomRow.textContent = countText;

    btn.appendChild(topRow);
    btn.appendChild(bottomRow);

    btn.addEventListener('click', () => {
      activePlaylist = id;
      lastClickedIndex = null;
      renderPlaylists();
      applyFiltersAndRenderTable();
      if (id !== 'ALL' && !probedFolders.has(currentSourceDir + '::' + id)) {
        probeFolder(id);
      }
    });

    return btn;
  }

  function updatePlaylistSummaryText() {
    const isRemux = getConvertMode() === 'remux_opus';
    const targetHz = getTargetRate();
    const targetBr = getTargetBitrate();
    const rateLabel = targetHz === 44100 ? '44.1 kHz' : '48 kHz';
    const specLabel = isRemux ? '.opus (Lossless Remux)' : `${rateLabel} • ${targetBr} kbps`;
    const verb = isRemux ? 'Remux' : 'Konversi';
    const plLabel = activePlaylist === 'ALL'
      ? 'Semua Koleksi'
      : (activePlaylist === '__ROOT__' ? 'Root Inbox' : activePlaylist);

    if (activePlaylistSummary) {
      activePlaylistSummary.textContent = `Playlist Aktif: ${plLabel} → Target ${specLabel}`;
    }
    if (btnConvertPlaylistText) {
      btnConvertPlaylistText.textContent = activePlaylist === 'ALL'
        ? `${verb} Seluruh Koleksi → ${specLabel}`
        : `${verb} Playlist "${plLabel}" → ${specLabel}`;
    }
  }

  // 5. Filter and Render Song Table
  function applyFiltersAndRenderTable() {
    const query = (searchInput.value || '').trim().toLowerCase();
    const fmtFilter = filterFormat.value;
    const rateFilter = filterRate.value;
    const brFilter = filterBitrate ? filterBitrate.value : 'ALL';
    const targetRate = getTargetRate();
    const targetBitrate = getTargetBitrate();
    const targetRateStr = String(targetRate);

    visibleFiles = allFiles.filter(f => {
      if (activePlaylist === '__ROOT__') {
        if (f.folder !== '') return false;
      } else if (activePlaylist !== 'ALL') {
        const topFolder = (f.folder || '').split('/')[0];
        if (topFolder !== activePlaylist && f.folder !== activePlaylist) return false;
      }

      if (query && !f.name.toLowerCase().includes(query) && !(f.folder || '').toLowerCase().includes(query)) {
        return false;
      }

      if (fmtFilter !== 'ALL' && f.ext !== fmtFilter) {
        return false;
      }

      const qc = f.qc || {};
      const sr = qc.sample_rate_hz ? String(qc.sample_rate_hz) : '';
      if (rateFilter === 'NEEDS_CONVERT') {
        if (isAlreadyMatching(f, targetRate, targetBitrate)) return false;
      } else if (rateFilter !== 'ALL') {
        if (sr !== rateFilter) return false;
      }

      if (brFilter !== 'ALL') {
        const brNum = qc.bitrate_kbps ? parseFloat(qc.bitrate_kbps) : 0;
        const filterBrNum = parseInt(brFilter, 10);
        if (!brNum || Math.abs(brNum - filterBrNum) > 8) return false;
      }

      return true;
    });

    renderTableRows(targetRateStr);
    syncRowSelectionDOM();
  }

  function renderTableRows(targetRateStr) {
    converterTableBody.replaceChildren();
    rowElementsByPath.clear();
    groupDomMap.clear();

    if (visibleFiles.length === 0) {
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      const td = document.createElement('td');
      td.setAttribute('colspan', '6');
      td.textContent = 'Tidak ada lagu yang cocok dengan filter saat ini.';
      tr.appendChild(td);
      converterTableBody.appendChild(tr);
      return;
    }

    const isRemux = getConvertMode() === 'remux_opus';
    const targetBr = getTargetBitrate();
    const targetRateNum = getTargetRate();
    const targetLabel = `${targetRateStr === '44100' ? '44.1 kHz' : '48 kHz'} • ${targetBr} kbps`;
    const fragment = document.createDocumentFragment();

    const groups = groupFilesByFolder(visibleFiles);
    let flatIdx = 0;

    groups.forEach(group => {
      const isCollapsed = collapsedGroups.has(group.key);
      const groupFilePaths = group.files.map(f => f.rel_path);

      // Collapsible Group Header Row with Group Select Checkbox
      const headerTr = document.createElement('tr');
      headerTr.className = 'group-header-row';

      const tdGroupCheck = document.createElement('td');
      tdGroupCheck.className = 'col-check';
      const groupChk = document.createElement('input');
      groupChk.type = 'checkbox';
      groupChk.title = `Pilih semua lagu di folder "${group.label}"`;
      groupChk.setAttribute('aria-label', `Pilih semua lagu di folder ${group.label}`);
      groupChk.addEventListener('click', (e) => {
        e.stopPropagation();
        const checkAll = groupChk.checked;
        groupFilePaths.forEach(rp => {
          if (checkAll) selectedPaths.add(rp);
          else selectedPaths.delete(rp);
        });
        syncRowSelectionDOM();
      });
      tdGroupCheck.appendChild(groupChk);
      headerTr.appendChild(tdGroupCheck);

      const headerTd = document.createElement('td');
      headerTd.setAttribute('colspan', '5');
      const { bar, chevron, toggleHint } = createGroupHeaderBar(group, isCollapsed, {
        onOpenExplorer: (g) => {
          openFolderInExplorer(g.isRoot ? '' : g.key, currentSourceDir);
        },
        onRenameFolder: (g) => {
          handleRenameFolder(g);
        },
        onDeleteFolder: (g) => {
          handleDeleteFolder(g);
        },
      });
      headerTd.appendChild(bar);
      headerTr.appendChild(headerTd);

      headerTr.addEventListener('click', () => {
        groupCollapseCtrl.toggleGroup(group.key);
      });

      fragment.appendChild(headerTr);

      const childRows = [];

      group.files.forEach((f, groupIdx) => {
        const currentFlatIdx = flatIdx++;
        const tr = document.createElement('tr');
        const isSelected = selectedPaths.has(f.rel_path);
        if (isSelected) tr.classList.add('row-selected');
        if (isCollapsed) tr.classList.add('group-row-hidden');

        // 1. Checkbox cell
        const tdCheck = document.createElement('td');
        tdCheck.className = 'col-check';
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = isSelected;
        chk.setAttribute('aria-label', 'Pilih ' + f.name);

        chk.addEventListener('click', (e) => {
          e.stopPropagation();
          handleRowSelect(currentFlatIdx, f.rel_path, chk.checked, e.shiftKey);
        });

        tdCheck.appendChild(chk);
        tr.appendChild(tdCheck);

        // Allow clicking the row to toggle selection
        tr.addEventListener('click', (e) => {
          const newChecked = !selectedPaths.has(f.rel_path);
          handleRowSelect(currentFlatIdx, f.rel_path, newChecked, e.shiftKey);
        });

        rowElementsByPath.set(f.rel_path, { tr, chk });

        // 2. Compact single-line song title + track number (folder is shown on group header)
        tr.appendChild(
          createFileNameCell(f, {
            index: groupIdx + 1,
            showFolderBadge: false,
            onRename: (fileObj) => {
              handleRenameFile(fileObj);
            },
            onDelete: (fileObj) => {
              handleDeleteFile(fileObj);
            },
          })
        );

        const qc = f.qc || {};

        // 3. Format / Codec
        const tdFormat = document.createElement('td');
        tdFormat.className = 'mono-cell';
        const codecLabel = qc.codec ? `${f.ext.replace('.', '').toUpperCase()} (${qc.codec})` : f.ext.toUpperCase();
        tdFormat.textContent = codecLabel;
        tr.appendChild(tdFormat);

        // 4. Bitrate & Size
        const tdSize = document.createElement('td');
        tdSize.className = 'mono-cell';
        const brVal = qc.bitrate_kbps ? Math.round(parseFloat(qc.bitrate_kbps)) : 0;
        if (brVal) {
          const brSpan = document.createElement('span');
          const brMatches = f.ext === '.mp3' && Math.abs(brVal - targetBr) <= 8;
          brSpan.className = brMatches ? 'rate-tag match' : 'rate-tag diff';
          brSpan.textContent = `${brVal} kbps`;
          tdSize.appendChild(brSpan);

          const sizeSpan = document.createElement('span');
          sizeSpan.textContent = ` • ${f.size_mb} MB`;
          tdSize.appendChild(sizeSpan);
        } else {
          tdSize.textContent = `${f.size_mb} MB`;
        }
        tr.appendChild(tdSize);

        // 5. Current Sample Rate
        const tdRate = document.createElement('td');
        tdRate.className = 'mono-cell';
        const sr = qc.sample_rate_hz ? String(qc.sample_rate_hz) : '';
        if (sr) {
          const srSpan = document.createElement('span');
          srSpan.className = sr === targetRateStr ? 'rate-tag match' : 'rate-tag diff';
          srSpan.textContent = sr + ' Hz';
          tdRate.appendChild(srSpan);
        } else {
          tdRate.textContent = 'Belum dipindai';
        }
        tr.appendChild(tdRate);

        // 6. Status Konversi
        const tdStatus = document.createElement('td');
        const badge = document.createElement('span');
        if (isRemux) {
          if (f.ext === '.opus') {
            badge.className = 'badge-safe';
            badge.textContent = 'SUDAH .OPUS';
          } else if (f.ext === '.webm' || f.ext === '.ogg') {
            badge.className = 'badge-warning';
            badge.textContent = 'SIAP REMUX → .OPUS';
          } else {
            badge.className = 'badge-untested';
            badge.textContent = 'BUKAN .WEBM (LEWATI)';
          }
        } else if (!sr) {
          badge.className = 'badge-untested';
          badge.textContent = 'KLIK CEK SAMPLE RATE';
        } else if (isAlreadyMatching(f, targetRateNum, targetBr)) {
          badge.className = 'badge-safe';
          badge.textContent = `SUDAH ${targetLabel}`;
        } else {
          badge.className = 'badge-warning';
          badge.textContent = `SIAP → ${targetLabel}`;
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

    converterTableBody.appendChild(fragment);
  }

  /**
   * Updates existing row and group checkboxes' checked/selected state in-place without rebuilding the table.
   */
  function syncRowSelectionDOM() {
    rowElementsByPath.forEach(({ tr, chk }, relPath) => {
      const isSelected = selectedPaths.has(relPath);
      chk.checked = isSelected;
      tr.classList.toggle('row-selected', isSelected);
    });

    groupDomMap.forEach(({ groupChk, filePaths }) => {
      if (!groupChk || filePaths.length === 0) return;
      const selCount = filePaths.filter(rp => selectedPaths.has(rp)).length;
      groupChk.checked = selCount === filePaths.length;
      groupChk.indeterminate = selCount > 0 && selCount < filePaths.length;
    });

    syncHeaderCheckbox();
    updateSelectionUI();
  }

  function handleRowSelect(idx, relPath, checked, isShift) {
    if (isShift && lastClickedIndex !== null && lastClickedIndex !== idx) {
      const start = Math.min(lastClickedIndex, idx);
      const end = Math.max(lastClickedIndex, idx);
      for (let i = start; i <= end; i++) {
        const item = visibleFiles[i];
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
    syncRowSelectionDOM();
  }

  function syncHeaderCheckbox() {
    if (!chkSelectAllVisible) return;
    if (visibleFiles.length === 0) {
      chkSelectAllVisible.checked = false;
      chkSelectAllVisible.indeterminate = false;
      return;
    }
    const visibleSelectedCount = visibleFiles.filter(f => selectedPaths.has(f.rel_path)).length;
    chkSelectAllVisible.checked = visibleSelectedCount === visibleFiles.length;
    chkSelectAllVisible.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleFiles.length;
  }

  function updateSelectionUI() {
    const count = selectedPaths.size;
    const isRemux = getConvertMode() === 'remux_opus';
    const rateLabel = getTargetRate() === 44100 ? '44.1 kHz' : '48 kHz';
    const brLabel = getTargetBitrate() + ' kbps';
    const specText = isRemux ? '.opus (Lossless)' : `${rateLabel} • ${brLabel}`;
    const verb = isRemux ? 'Remux' : 'Konversi';
    if (selectionCounterPill) {
      selectionCounterPill.textContent = `${count} lagu dipilih`;
    }
    if (btnConvertSelectedText) {
      btnConvertSelectedText.textContent = `${verb} Lagu Terpilih (${count}) → ${specText}`;
    }
    if (btnConvertSelected) {
      btnConvertSelected.disabled = count === 0;
    }
    if (btnDeleteSelectedText) {
      btnDeleteSelectedText.textContent = `Hapus Terpilih (${count})`;
    }
    if (btnDeleteSelected) {
      btnDeleteSelected.disabled = count === 0;
    }
  }

  // 6. Queue polling via shared monitor
  const queueMonitor = createQueueMonitor({
    queueCounter,
    jobStatusTag,
    jobUrlLabel,
    progressFill,
    progressText,
    terminalLogs,
    onTaskFinished: (task) => {
      if (Array.isArray(task.logs) && task.logs.length > 0) {
        renderLogs(terminalLogs, task.logs);
      }
      fetchLibrary();
    },
    onIdle: (justFinished, data) => {
      if (justFinished) {
        progressFill.style.width = '100%';
        progressText.textContent = '100% Complete';
        if (Array.isArray(data.history) && data.history.length > 0 && Array.isArray(data.history[0].logs)) {
          renderLogs(terminalLogs, data.history[0].logs);
        }
        fetchLibrary();
      }
    },
  });

  // 7. Event Listeners
  convertModeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      syncConvertModeUI();
      updatePlaylistSummaryText();
      applyFiltersAndRenderTable();
      updateSelectionUI();
    });
  });

  targetRateRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      updatePlaylistSummaryText();
      applyFiltersAndRenderTable();
      updateSelectionUI();
    });
  });

  targetBitrateRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      updatePlaylistSummaryText();
      applyFiltersAndRenderTable();
      updateSelectionUI();
    });
  });

  searchInput.addEventListener('input', applyFiltersAndRenderTable);
  filterFormat.addEventListener('change', applyFiltersAndRenderTable);
  filterRate.addEventListener('change', applyFiltersAndRenderTable);
  if (filterBitrate) {
    filterBitrate.addEventListener('change', applyFiltersAndRenderTable);
  }

  chkSelectAllVisible.addEventListener('change', () => {
    const check = chkSelectAllVisible.checked;
    visibleFiles.forEach(f => {
      if (check) selectedPaths.add(f.rel_path);
      else selectedPaths.delete(f.rel_path);
    });
    syncRowSelectionDOM();
  });

  btnSelectVisible.addEventListener('click', () => {
    visibleFiles.forEach(f => selectedPaths.add(f.rel_path));
    syncRowSelectionDOM();
  });

  btnSelectNeedConvert.addEventListener('click', () => {
    const targetRate = getTargetRate();
    const targetBitrate = getTargetBitrate();
    visibleFiles.forEach(f => {
      if (!isAlreadyMatching(f, targetRate, targetBitrate)) {
        selectedPaths.add(f.rel_path);
      }
    });
    syncRowSelectionDOM();
  });

  btnClearSelection.addEventListener('click', () => {
    selectedPaths.clear();
    lastClickedIndex = null;
    syncRowSelectionDOM();
  });

  btnProbeCurrent.addEventListener('click', () => {
    probeFolder(activePlaylist, true);
  });

  // Source & Destination Folder Controls + Folder Browser Modal
  async function loadCustomSourceFolder(rawPath) {
    const cleanPath = (rawPath || '').trim();
    selectedPaths.clear();
    lastClickedIndex = null;
    activePlaylist = 'ALL';
    const ok = await fetchLibrary(cleanPath);
    if (ok) {
      log('info', '[SOURCE] Memuat folder sumber: ' + currentSourceDir);
      notify({
        type: 'info',
        title: 'Folder Sumber Dimuat',
        message: `${allFiles.length} file audio ditemukan di ${currentSourceDir}`,
        duration: 4000,
      });
      const mp3Playlist = allPlaylists.find(p => p.mp3_count > 0);
      if (mp3Playlist) {
        activePlaylist = mp3Playlist.name;
        renderPlaylists();
        applyFiltersAndRenderTable();
        probeFolder(mp3Playlist.name);
      } else if (allFiles.length > 0 && allFiles.length <= 120) {
        probeFolder('ALL');
      }
    }
  }

  if (btnLoadSource) {
    btnLoadSource.addEventListener('click', () => {
      loadCustomSourceFolder(sourceDirInput ? sourceDirInput.value : '');
    });
  }

  if (sourceDirInput) {
    sourceDirInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        loadCustomSourceFolder(sourceDirInput.value);
      }
    });
  }

  if (btnClearDest && destDirInput) {
    btnClearDest.addEventListener('click', () => {
      destDirInput.value = '';
      log('info', '[DESTINATION] Mode tujuan dikembalikan ke otomatis (folder baru di samping sumber).');
    });
  }

  initFolderModal({
    folderModal: document.getElementById('folderModal'),
    folderModalTitle: document.getElementById('folderModalTitle'),
    btnCloseModal: document.getElementById('btnCloseModal'),
    modalShortcuts: document.getElementById('modalShortcuts'),
    btnModalUp: document.getElementById('btnModalUp'),
    modalCurrentPath: document.getElementById('modalCurrentPath'),
    modalDirList: document.getElementById('modalDirList'),
    newFolderNameInput: document.getElementById('newFolderNameInput'),
    btnCreateSubfolder: document.getElementById('btnCreateSubfolder'),
    btnCancelModal: document.getElementById('btnCancelModal'),
    btnSelectModalDir: document.getElementById('btnSelectModalDir'),
    btnBrowseSource,
    btnBrowseDest,
    getStartPath: (mode) => {
      if (mode === 'source') {
        return (sourceDirInput && sourceDirInput.value.trim()) || currentSourceDir;
      }
      return (destDirInput && destDirInput.value.trim()) || currentSourceDir;
    },
    onSelectSource: (chosenPath) => {
      if (sourceDirInput) sourceDirInput.value = chosenPath;
      loadCustomSourceFolder(chosenPath);
    },
    onSelectDest: (chosenPath) => {
      if (destDirInput) destDirInput.value = chosenPath;
      log('info', '[DESTINATION] Folder tujuan disetel ke: ' + chosenPath);
      notify({
        type: 'info',
        title: 'Folder Tujuan Disetel',
        message: 'Hasil konversi akan disimpan ke: ' + chosenPath,
        duration: 4000,
      });
    },
    onLog: log,
  });

  // Shared helper for scheduling a resample job
  async function dispatchResampleJob(payload, notifTitle) {
    const { ok, data, error } = await apiPost('/api/resample', payload);
    if (ok) {
      log('info', '[QUEUE] ' + data.message);
      notify({
        type: 'info',
        title: notifTitle,
        message: data.message,
      });
      queueMonitor.poll();
      return true;
    }
    const errMsg = error || 'Gagal menjadwalkan konversi.';
    log('error', '[ERROR] ' + errMsg);
    notify({
      type: 'error',
      title: 'Gagal Menjadwalkan Konversi',
      message: errMsg,
      playSound: true,
    });
    return false;
  }

  if (btnDeleteSelected) {
    btnDeleteSelected.addEventListener('click', () => {
      handleBatchDeleteSelected();
    });
  }

  // Convert Selected Songs (Batch Checkboxes)
  btnConvertSelected.addEventListener('click', async () => {
    if (selectedPaths.size === 0) return;
    const relPaths = Array.from(selectedPaths);
    const mode = getConvertMode();
    const targetRate = getTargetRate();
    const targetBitrate = getTargetBitrate();
    const overwrite = optOverwrite ? optOverwrite.checked : false;
    const destDirVal = destDirInput && destDirInput.value.trim() ? destDirInput.value.trim() : null;

    btnConvertSelected.disabled = true;
    const descTarget = mode === 'remux_opus' ? '.opus (Lossless Remux)' : `${targetRate} Hz • ${targetBitrate} kbps`;
    log('info', `[DISPATCH] Menjadwalkan proses ${relPaths.length} lagu terpilih ke ${descTarget}...`);

    const ok = await dispatchResampleJob(
      {
        mode,
        source_dir: currentSourceDir || null,
        dest_dir: destDirVal,
        rel_paths: relPaths,
        target_rate: targetRate,
        target_bitrate: targetBitrate,
        only_mp3: false,
        overwrite,
      },
      mode === 'remux_opus' ? 'Remux .opus Masuk Antrian' : 'Konversi Masuk Antrian'
    );
    if (!ok) {
      btnConvertSelected.disabled = false;
    }
  });

  // Convert Entire Active Playlist
  btnConvertPlaylist.addEventListener('click', async () => {
    const mode = getConvertMode();
    const targetRate = getTargetRate();
    const targetBitrate = getTargetBitrate();
    const onlyMp3 = optOnlyMp3 ? optOnlyMp3.checked : true;
    const overwrite = optOverwrite ? optOverwrite.checked : false;
    const playlistArg = activePlaylist === 'ALL' ? null : activePlaylist;
    const destDirVal = destDirInput && destDirInput.value.trim() ? destDirInput.value.trim() : null;

    btnConvertPlaylist.disabled = true;
    const descTarget = mode === 'remux_opus' ? '.opus (Lossless Remux)' : `${targetRate} Hz • ${targetBitrate} kbps`;
    log('info', `[DISPATCH] Menjadwalkan proses playlist (${activePlaylist}) ke ${descTarget}...`);

    try {
      await dispatchResampleJob(
        {
          mode,
          source_dir: currentSourceDir || null,
          dest_dir: destDirVal,
          playlist: playlistArg,
          target_rate: targetRate,
          target_bitrate: targetBitrate,
          only_mp3: onlyMp3,
          overwrite,
        },
        mode === 'remux_opus' ? 'Remux Playlist Dijadwalkan' : 'Konversi Playlist Dijadwalkan'
      );
    } finally {
      setTimeout(() => {
        btnConvertPlaylist.disabled = false;
      }, 1000);
    }
  });

  if (btnOpenSourceExplorer) {
    btnOpenSourceExplorer.addEventListener('click', () => {
      openFolderInExplorer('', currentSourceDir);
    });
  }

  btnClearLogs.addEventListener('click', () => {
    terminalLogs.replaceChildren();
  });

  // Initialize
  fetchLibrary().then(() => {
    const mp3Playlist = allPlaylists.find(p => p.mp3_count > 0);
    if (mp3Playlist) {
      activePlaylist = mp3Playlist.name;
      renderPlaylists();
      applyFiltersAndRenderTable();
      probeFolder(mp3Playlist.name);
    }
  });
  queueMonitor.poll();

  setInterval(() => {
    queueMonitor.poll();
  }, 1500);
});
