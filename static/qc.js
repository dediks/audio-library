/**
 * SWARARIA AUDIO LAB - Stage 2: Soundsystem QC & Spectral Lab Client Logic
 * Strict DOM Manipulation (No innerHTML, strictly textContent & createElement)
 */

import {
  initAppHeader,
  apiGet,
  apiPost,
  notify,
  groupFiles,
  createGroupHeaderBar,
  createFileNameCell,
  createGroupCollapseController,
  createSpectralBadge,
  openFolderInExplorer,
  getSharedWorkspaceState,
  saveSharedWorkspaceState,
} from './modules/ui-shared.js';
import { initFolderModal } from './modules/folder-modal.js';

document.addEventListener('DOMContentLoaded', () => {
  initAppHeader({ activePage: 'qc' });

  const kpiTotalCount = document.getElementById('kpiTotalCount');
  const kpiAuditedSub = document.getElementById('kpiAuditedSub');
  const kpiSafeCount = document.getElementById('kpiSafeCount');
  const kpiWarnCount = document.getElementById('kpiWarnCount');
  const kpiDangerCount = document.getElementById('kpiDangerCount');

  const btnOpenExplorer = document.getElementById('btnOpenExplorer');
  const btnProbeSpectral = document.getElementById('btnProbeSpectral');
  const btnProbeSpectralText = document.getElementById('btnProbeSpectralText');
  const btnAuditAll = document.getElementById('btnAuditAll');
  const btnAuditAllText = document.getElementById('btnAuditAllText');
  const btnSendToNormalizer = document.getElementById('btnSendToNormalizer');
  const btnSendToNormalizerText = document.getElementById('btnSendToNormalizerText');

  const activeSourceBadge = document.getElementById('activeSourceBadge');
  const sourceDirInput = document.getElementById('sourceDirInput');
  const qcStatusHint = document.getElementById('qcStatusHint');
  const btnBrowseSource = document.getElementById('btnBrowseSource');
  const btnResetInbox = document.getElementById('btnResetInbox');
  const playlistGrid = document.getElementById('playlistGrid');

  const searchInput = document.getElementById('searchInput');
  const groupByMode = document.getElementById('groupByMode');
  const filterQcStatus = document.getElementById('filterQcStatus');
  const filterFormat = document.getElementById('filterFormat');

  const selectionCounterPill = document.getElementById('selectionCounterPill');
  const btnCollapseAllGroups = document.getElementById('btnCollapseAllGroups');
  const btnExpandAllGroups = document.getElementById('btnExpandAllGroups');
  const btnSelectIssues = document.getElementById('btnSelectIssues');
  const btnSelectVisible = document.getElementById('btnSelectVisible');
  const btnClearSelection = document.getElementById('btnClearSelection');

  const chkSelectAllVisible = document.getElementById('chkSelectAllVisible');
  const qcTableBody = document.getElementById('qcTableBody');

  // Shared Workspace State Initialization
  const sharedInit = getSharedWorkspaceState();
  let currentSourceDir = sharedInit.sourceDir || '';
  let defaultInboxDir = '';
  let activePlaylist = sharedInit.activePlaylist || 'ALL';
  const selectedPaths = new Set(Array.isArray(sharedInit.selectedPaths) ? sharedInit.selectedPaths : []);

  let allFiles = [];
  let allPlaylists = [];
  let visibleFiles = [];
  let lastClickedIndex = null;
  const collapsedGroups = new Set();
  const rowElementsByPath = new Map();
  const groupDomMap = new Map();
  let isAuditRunning = false;

  const groupCollapseCtrl = createGroupCollapseController({
    collapsedGroups,
    groupDomMap,
    btnCollapseAll: btnCollapseAllGroups,
    btnExpandAll: btnExpandAllGroups,
  });

  function persistWorkspaceState() {
    saveSharedWorkspaceState({
      sourceDir: currentSourceDir,
      activePlaylist,
      selectedPaths: Array.from(selectedPaths),
    });
  }

  function classifyFileQc(fileObj) {
    const qc = fileObj.qc || {};
    const status = qc.soundsystem_status || 'UNTESTED';
    const specStatus = qc.spectral_status || '';
    const hasTp = qc.true_peak_dbtp !== undefined && qc.true_peak_dbtp !== '';
    const tp = hasTp ? parseFloat(qc.true_peak_dbtp) : NaN;

    const isFakeHq = specStatus === 'FAKE_HQ';
    const isClipping = status.includes('CLIPPING') || (!Number.isNaN(tp) && tp > 0.0);
    const isTrim = !isClipping && (status.includes('TRIM') || (!Number.isNaN(tp) && tp > -1.0 && tp <= 0.0));
    const isSafe = !isClipping && !isTrim && !isFakeHq && (status.includes('READY') || (!Number.isNaN(tp) && tp <= -1.0));
    const isAudited = hasTp || Boolean(specStatus);

    return {
      isFakeHq,
      isClipping,
      isTrim,
      isSafe,
      isAudited,
      hasIssue: isClipping || isTrim || isFakeHq,
      tp,
    };
  }

  function updateKpiCards() {
    let audited = 0;
    let safe = 0;
    let warn = 0;
    let danger = 0;

    allFiles.forEach(f => {
      const diag = classifyFileQc(f);
      if (diag.isAudited) audited++;
      if (diag.isClipping || diag.isFakeHq) {
        danger++;
      } else if (diag.isTrim) {
        warn++;
      } else if (diag.isSafe) {
        safe++;
      }
    });

    if (kpiTotalCount) kpiTotalCount.textContent = String(allFiles.length);
    if (kpiAuditedSub) kpiAuditedSub.textContent = `${audited} dari ${allFiles.length} lagu telah dipindai`;
    if (kpiSafeCount) kpiSafeCount.textContent = String(safe);
    if (kpiWarnCount) kpiWarnCount.textContent = String(warn);
    if (kpiDangerCount) kpiDangerCount.textContent = String(danger);
  }

  function syncSourceLocationUI() {
    const isDefault =
      !currentSourceDir ||
      (defaultInboxDir && currentSourceDir === defaultInboxDir) ||
      currentSourceDir.endsWith('/library/inbox') ||
      currentSourceDir.endsWith('\\library\\inbox');
    if (activeSourceBadge) {
      activeSourceBadge.textContent = isDefault
        ? 'library/inbox (Koleksi Default Aplikasi)'
        : currentSourceDir;
      activeSourceBadge.title = currentSourceDir || 'library/inbox';
    }
    if (btnResetInbox) {
      btnResetInbox.classList.toggle('hidden', isDefault);
    }
  }

  async function fetchLibrary(customSource) {
    const targetSource = typeof customSource === 'string' ? customSource.trim() : currentSourceDir;
    const url = targetSource
      ? '/api/library?source_dir=' + encodeURIComponent(targetSource)
      : '/api/library';
    const { ok, data, error } = await apiGet(url);
    if (!ok) {
      notify({
        type: 'error',
        title: 'Gagal Memuat Koleksi Audio',
        message: error || 'Tidak dapat membaca direktori sumber.',
        playSound: true,
      });
      return false;
    }

    if (data.default_inbox) defaultInboxDir = data.default_inbox;
    if (data.source_dir) {
      currentSourceDir = data.source_dir;
      if (sourceDirInput) sourceDirInput.value = data.source_dir;
    }
    syncSourceLocationUI();

    allFiles = data.files || [];
    allPlaylists = data.playlists || [];

    const validSet = new Set(allFiles.map(f => f.rel_path));
    Array.from(selectedPaths).forEach(p => {
      if (!validSet.has(p)) selectedPaths.delete(p);
    });

    updateKpiCards();
    renderPlaylists();
    applyFiltersAndRenderTable();
    updateSelectionUI();
    persistWorkspaceState();
    return true;
  }

  function renderPlaylists() {
    if (!playlistGrid) return;
    playlistGrid.replaceChildren();

    const totalSongs = allFiles.length;
    const totalMp3 = allFiles.filter(f => f.ext === '.mp3').length;
    const fragment = document.createDocumentFragment();

    fragment.appendChild(
      createPlaylistCard('ALL', 'Semua Koleksi (Tampilkan Semua)', `${totalSongs} lagu total`, `${totalMp3} MP3`)
    );

    allPlaylists.forEach(pl => {
      const displayLabel = pl.label || ('📁 ' + pl.name);
      const subText = `${pl.total} lagu`;
      const badgeText = pl.mp3_count > 0 ? `${pl.mp3_count} MP3` : `${pl.other_count} Native`;
      fragment.appendChild(createPlaylistCard(pl.name, displayLabel, subText, badgeText));
    });

    playlistGrid.appendChild(fragment);
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
      persistWorkspaceState();
    });

    return btn;
  }

  function applyFiltersAndRenderTable() {
    const query = (searchInput && searchInput.value ? searchInput.value : '').trim().toLowerCase();
    const qcFilter = filterQcStatus ? filterQcStatus.value : 'ALL';
    const fmtFilter = filterFormat ? filterFormat.value : 'ALL';

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

      if (qcFilter !== 'ALL') {
        const diag = classifyFileQc(f);
        if (qcFilter === 'ISSUES' && !diag.hasIssue) return false;
        if (qcFilter === 'CLIPPING' && !diag.isClipping) return false;
        if (qcFilter === 'TRIM' && !diag.isTrim) return false;
        if (qcFilter === 'SAFE' && !diag.isSafe) return false;
        if (qcFilter === 'FAKE_HQ' && !diag.isFakeHq) return false;
      }

      return true;
    });

    renderTableRows();
    syncRowSelectionDOM();
  }

  function renderTableRows() {
    qcTableBody.replaceChildren();
    rowElementsByPath.clear();
    groupDomMap.clear();

    if (visibleFiles.length === 0) {
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      const td = document.createElement('td');
      td.setAttribute('colspan', '9');
      td.textContent = 'Tidak ada lagu yang cocok dengan filter QC saat ini.';
      tr.appendChild(td);
      qcTableBody.appendChild(tr);
      return;
    }

    const currentGroupBy = groupByMode ? groupByMode.value : 'folder';
    const showRowFolder = currentGroupBy === 'type' || currentGroupBy === 'rate';
    const groups = groupFiles(visibleFiles, currentGroupBy);
    const fragment = document.createDocumentFragment();
    let flatIdx = 0;

    groups.forEach(group => {
      const isCollapsed = collapsedGroups.has(group.key);
      const groupFilePaths = group.files.map(f => f.rel_path);

      const headerTr = document.createElement('tr');
      headerTr.className = 'group-header-row';

      const tdGroupCheck = document.createElement('td');
      tdGroupCheck.className = 'col-check';
      const groupChk = document.createElement('input');
      groupChk.type = 'checkbox';
      groupChk.title = `Pilih semua lagu di grup "${group.label}"`;
      groupChk.addEventListener('click', (e) => {
        e.stopPropagation();
        const checkAll = groupChk.checked;
        groupFilePaths.forEach(rp => {
          if (checkAll) selectedPaths.add(rp);
          else selectedPaths.delete(rp);
        });
        syncRowSelectionDOM();
        persistWorkspaceState();
      });
      tdGroupCheck.appendChild(groupChk);
      headerTr.appendChild(tdGroupCheck);

      const headerTd = document.createElement('td');
      headerTd.setAttribute('colspan', '8');
      const { bar, chevron, toggleHint } = createGroupHeaderBar(group, isCollapsed, {
        onOpenExplorer: (g) => {
          openFolderInExplorer(g.isRoot ? '' : (g.folderPath || g.key), currentSourceDir);
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

        // 1. Checkbox
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

        tr.addEventListener('click', (e) => {
          const newChecked = !selectedPaths.has(f.rel_path);
          handleRowSelect(currentFlatIdx, f.rel_path, newChecked, e.shiftKey);
        });

        rowElementsByPath.set(f.rel_path, { tr, chk });

        // 2. Nama File Audio
        tr.appendChild(
          createFileNameCell(f, {
            index: groupIdx + 1,
            showFolderBadge: showRowFolder,
          })
        );

        const qc = f.qc || {};
        const diag = classifyFileQc(f);

        // 3. Codec & Bitrate
        const tdCodec = document.createElement('td');
        tdCodec.className = 'mono-cell';
        const extUpper = (f.ext || '').replace('.', '').toUpperCase();
        const codecStr = qc.codec ? `${extUpper} (${qc.codec})` : extUpper;
        const brVal = qc.bitrate_kbps ? `${Math.round(parseFloat(qc.bitrate_kbps))} kbps` : `${f.size_mb} MB`;
        tdCodec.textContent = `${codecStr} • ${brVal}`;
        tr.appendChild(tdCodec);

        // 4. Spektrum Frekuensi
        const tdSpec = document.createElement('td');
        tdSpec.className = 'mono-cell';
        const specBadge = createSpectralBadge(qc);
        if (specBadge) {
          tdSpec.appendChild(specBadge);
        } else {
          const untSpan = document.createElement('span');
          untSpan.className = 'badge-untested';
          untSpan.textContent = 'Belum Dipindai';
          tdSpec.appendChild(untSpan);
        }
        tr.appendChild(tdSpec);

        // 5. Sample Rate
        const tdRate = document.createElement('td');
        tdRate.className = 'mono-cell';
        tdRate.textContent = qc.sample_rate_hz ? `${qc.sample_rate_hz} Hz` : '-';
        tr.appendChild(tdRate);

        // 6. True Peak (dBTP)
        const tdTp = document.createElement('td');
        tdTp.className = 'mono-cell';
        if (!Number.isNaN(diag.tp)) {
          const tpSpan = document.createElement('span');
          tpSpan.textContent = `${diag.tp.toFixed(1)} dBTP`;
          if (diag.tp > 0.0) {
            tpSpan.style.color = '#ff6b6b';
            tpSpan.style.fontWeight = '700';
          } else if (diag.tp > -1.0) {
            tpSpan.style.color = '#ffd043';
            tpSpan.style.fontWeight = '600';
          } else {
            tpSpan.style.color = '#00ffaa';
          }
          tdTp.appendChild(tpSpan);
        } else {
          tdTp.textContent = '-';
        }
        tr.appendChild(tdTp);

        // 7. Integrated LUFS
        const tdLufs = document.createElement('td');
        tdLufs.className = 'mono-cell';
        const hasLufs = qc.integrated_lufs !== undefined && qc.integrated_lufs !== '';
        tdLufs.textContent = hasLufs ? `${qc.integrated_lufs} LUFS` : '-';
        tr.appendChild(tdLufs);

        // 8. LRA (LU)
        const tdLra = document.createElement('td');
        tdLra.className = 'mono-cell';
        const hasLra = qc.loudness_range_lu !== undefined && qc.loudness_range_lu !== '';
        tdLra.textContent = hasLra ? `${qc.loudness_range_lu} LU` : '-';
        tr.appendChild(tdLra);

        // 9. Status Soundsystem
        const tdStatus = document.createElement('td');
        const statusBadge = document.createElement('span');
        if (diag.isClipping) {
          statusBadge.className = 'badge-danger';
          statusBadge.textContent = 'CLIPPING HAZARD';
        } else if (diag.isFakeHq) {
          statusBadge.className = 'badge-danger';
          statusBadge.textContent = 'FAKE HQ / UPSAMPLED';
        } else if (diag.isTrim) {
          statusBadge.className = 'badge-warning';
          statusBadge.textContent = 'TRIM PREAMP (-2dB)';
        } else if (diag.isSafe) {
          statusBadge.className = 'badge-safe';
          statusBadge.textContent = 'READY FOR FOH';
        } else {
          statusBadge.className = 'badge-untested';
          statusBadge.textContent = 'BELUM DIAUDIT';
        }
        tdStatus.appendChild(statusBadge);
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

    qcTableBody.appendChild(fragment);
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
    persistWorkspaceState();
  }

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

    if (chkSelectAllVisible) {
      if (visibleFiles.length === 0) {
        chkSelectAllVisible.checked = false;
        chkSelectAllVisible.indeterminate = false;
      } else {
        const visSel = visibleFiles.filter(f => selectedPaths.has(f.rel_path)).length;
        chkSelectAllVisible.checked = visSel === visibleFiles.length;
        chkSelectAllVisible.indeterminate = visSel > 0 && visSel < visibleFiles.length;
      }
    }

    updateSelectionUI();
  }

  function updateSelectionUI() {
    const count = selectedPaths.size;
    if (selectionCounterPill) {
      selectionCounterPill.textContent = `${count} lagu dipilih`;
    }
    if (btnSendToNormalizerText) {
      btnSendToNormalizerText.textContent = `🎚️ Normalisasi Terpilih (${count}) →`;
    }
    if (btnSendToNormalizer) {
      btnSendToNormalizer.disabled = count === 0;
    }
  }

  // Fast Spectral Probe
  if (btnProbeSpectral) {
    btnProbeSpectral.addEventListener('click', async () => {
      btnProbeSpectral.disabled = true;
      if (btnProbeSpectralText) btnProbeSpectralText.textContent = 'Memindai Spektrum...';
      if (qcStatusHint) qcStatusHint.textContent = 'Menganalisis frekuensi tinggi 16 kHz / 20 kHz...';
      try {
        const payload = { probe_spectral: true };
        if (activePlaylist !== 'ALL') payload.folder = activePlaylist;
        if (currentSourceDir) payload.source_dir = currentSourceDir;

        const { ok, data, error } = await apiPost('/api/probe', payload);
        if (ok) {
          allFiles = data.files || [];
          allPlaylists = data.playlists || [];
          updateKpiCards();
          renderPlaylists();
          applyFiltersAndRenderTable();
          notify({
            type: 'success',
            title: 'Spektrum Frekuensi Diperbarui',
            message: `Berhasil memeriksa keaslian spektrum pada ${visibleFiles.length} lagu.`,
            duration: 3800,
          });
        } else {
          notify({
            type: 'error',
            title: 'Gagal Memindai Spektrum',
            message: error || 'Terjadi kesalahan saat memindai spektrum.',
            playSound: true,
          });
        }
      } finally {
        btnProbeSpectral.disabled = false;
        if (btnProbeSpectralText) btnProbeSpectralText.textContent = 'Cek Cepat Spektrum';
        if (qcStatusHint) qcStatusHint.textContent = 'Pilih lagu di tabel lalu kirim ke Normalizer atau Tag Organizer';
      }
    });
  }

  // Full EBU R128 Audit Scan
  if (btnAuditAll) {
    btnAuditAll.addEventListener('click', async () => {
      if (isAuditRunning) return;
      isAuditRunning = true;
      btnAuditAll.disabled = true;
      if (btnAuditAllText) btnAuditAllText.textContent = 'Mengaudit EBU R128...';
      if (qcStatusHint) qcStatusHint.textContent = 'Menghitung True Peak (dBTP), LUFS, LRA, dan Spektrum...';

      const { ok, data, error } = await apiPost('/api/scan', {
        source_dir: currentSourceDir || null,
      });

      if (!ok) {
        isAuditRunning = false;
        btnAuditAll.disabled = false;
        if (btnAuditAllText) btnAuditAllText.textContent = 'Jalankan Full QC Audit';
        notify({
          type: 'error',
          title: 'Gagal Menjalankan Audit QC',
          message: error || 'Tidak dapat menjadwalkan pemindaian QC.',
          playSound: true,
        });
        return;
      }

      notify({
        type: 'info',
        title: 'Audit QC EBU R128 Dimulai',
        message: data?.message || 'Memindai seluruh koleksi audio di latar belakang...',
      });

      const pollTimer = setInterval(async () => {
        const qRes = await apiGet('/api/queue');
        if (!qRes.ok) return;
        const active = qRes.data.active;
        if (active && active.type === 'qc_scan') {
          const pct = Math.round(active.progress || 0);
          if (btnAuditAllText) btnAuditAllText.textContent = `Audit QC (${pct}%)...`;
        } else {
          clearInterval(pollTimer);
          isAuditRunning = false;
          btnAuditAll.disabled = false;
          if (btnAuditAllText) btnAuditAllText.textContent = 'Jalankan Full QC Audit';
          if (qcStatusHint) qcStatusHint.textContent = 'Audit selesai! Lagu merah/kuning siap dikirim ke Normalizer.';
          await fetchLibrary();
          notify({
            type: 'success',
            title: 'Audit QC Soundsystem Selesai',
            message: 'Seluruh nilai True Peak (dBTP), LUFS, dan Spektrum berhasil diperbarui.',
            playSound: true,
          });
        }
      }, 1200);
    });
  }

  // Send Selected to Stage 3 Converter & Normalizer
  if (btnSendToNormalizer) {
    btnSendToNormalizer.addEventListener('click', () => {
      if (selectedPaths.size === 0) return;
      persistWorkspaceState();
      window.location.href = '/converter?mode=normalize';
    });
  }

  if (btnSelectIssues) {
    btnSelectIssues.addEventListener('click', () => {
      let added = 0;
      visibleFiles.forEach(f => {
        const diag = classifyFileQc(f);
        if (diag.hasIssue) {
          selectedPaths.add(f.rel_path);
          added++;
        }
      });
      syncRowSelectionDOM();
      persistWorkspaceState();
      notify({
        type: added > 0 ? 'info' : 'warning',
        title: added > 0 ? `${added} Lagu Bermasalah Dipilih` : 'Tidak Ada Lagu Bermasalah',
        message: added > 0
          ? 'Klik tombol "🎚️ Normalisasi Terpilih" untuk memperbaiki level dBTP & LUFS di halaman Converter.'
          : 'Semua lagu yang tampil sudah berada pada batas aman atau belum diaudit.',
        duration: 3500,
      });
    });
  }

  if (btnSelectVisible) {
    btnSelectVisible.addEventListener('click', () => {
      visibleFiles.forEach(f => selectedPaths.add(f.rel_path));
      syncRowSelectionDOM();
      persistWorkspaceState();
    });
  }

  if (btnClearSelection) {
    btnClearSelection.addEventListener('click', () => {
      selectedPaths.clear();
      lastClickedIndex = null;
      syncRowSelectionDOM();
      persistWorkspaceState();
    });
  }

  if (chkSelectAllVisible) {
    chkSelectAllVisible.addEventListener('change', () => {
      const check = chkSelectAllVisible.checked;
      visibleFiles.forEach(f => {
        if (check) selectedPaths.add(f.rel_path);
        else selectedPaths.delete(f.rel_path);
      });
      syncRowSelectionDOM();
      persistWorkspaceState();
    });
  }

  if (searchInput) searchInput.addEventListener('input', applyFiltersAndRenderTable);
  if (groupByMode) {
    groupByMode.addEventListener('change', () => {
      collapsedGroups.clear();
      applyFiltersAndRenderTable();
    });
  }
  if (filterQcStatus) filterQcStatus.addEventListener('change', applyFiltersAndRenderTable);
  if (filterFormat) filterFormat.addEventListener('change', applyFiltersAndRenderTable);

  if (btnOpenExplorer) {
    btnOpenExplorer.addEventListener('click', () => {
      openFolderInExplorer('', currentSourceDir);
    });
  }

  if (btnResetInbox) {
    btnResetInbox.addEventListener('click', () => {
      selectedPaths.clear();
      activePlaylist = 'ALL';
      fetchLibrary(defaultInboxDir || '');
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
    getStartPath: () => currentSourceDir,
    onSelectSource: (chosenPath) => {
      selectedPaths.clear();
      activePlaylist = 'ALL';
      fetchLibrary(chosenPath);
    },
  });

  fetchLibrary(currentSourceDir);
});

