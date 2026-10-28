/**
 * Audio Lab - Sample Rate & Batch Playlist Converter Client Logic
 * Strict DOM Manipulation (No innerHTML, strictly textContent & createElement)
 */

document.addEventListener('DOMContentLoaded', () => {
  const ffmpegDot = document.getElementById('ffmpegDot');
  const ffmpegVal = document.getElementById('ffmpegVal');

  const playlistGrid = document.getElementById('playlistGrid');
  const probeStatusHint = document.getElementById('probeStatusHint');
  const activePlaylistSummary = document.getElementById('activePlaylistSummary');
  const btnConvertPlaylist = document.getElementById('btnConvertPlaylist');
  const btnConvertPlaylistText = document.getElementById('btnConvertPlaylistText');

  const optOnlyMp3 = document.getElementById('optOnlyMp3');
  const optOverwrite = document.getElementById('optOverwrite');
  const targetRateRadios = document.querySelectorAll('input[name="targetRate"]');
  const targetBitrateRadios = document.querySelectorAll('input[name="targetBitrate"]');

  const queueCounter = document.getElementById('queueCounter');
  const jobStatusTag = document.getElementById('jobStatusTag');
  const jobUrlLabel = document.getElementById('jobUrlLabel');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const terminalLogs = document.getElementById('terminalLogs');
  const btnClearLogs = document.getElementById('btnClearLogs');

  const btnProbeCurrent = document.getElementById('btnProbeCurrent');
  const btnConvertSelected = document.getElementById('btnConvertSelected');
  const btnConvertSelectedText = document.getElementById('btnConvertSelectedText');

  const searchInput = document.getElementById('searchInput');
  const filterFormat = document.getElementById('filterFormat');
  const filterRate = document.getElementById('filterRate');
  const filterBitrate = document.getElementById('filterBitrate');

  const selectionCounterPill = document.getElementById('selectionCounterPill');
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

  // Folder Browser Modal elements
  const folderModal = document.getElementById('folderModal');
  const folderModalTitle = document.getElementById('folderModalTitle');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const modalShortcuts = document.getElementById('modalShortcuts');
  const btnModalUp = document.getElementById('btnModalUp');
  const modalCurrentPath = document.getElementById('modalCurrentPath');
  const modalDirList = document.getElementById('modalDirList');
  const newFolderNameInput = document.getElementById('newFolderNameInput');
  const btnCreateSubfolder = document.getElementById('btnCreateSubfolder');
  const btnCancelModal = document.getElementById('btnCancelModal');
  const btnSelectModalDir = document.getElementById('btnSelectModalDir');

  // State
  let allFiles = [];
  let allPlaylists = [];
  let activePlaylist = 'ALL'; // 'ALL', '__ROOT__', or folder name
  const selectedPaths = new Set();
  let visibleFiles = [];
  let lastClickedIndex = null;
  let wasJobRunning = false;
  const probedFolders = new Set();
  let currentSourceDir = '';
  let modalTargetMode = 'source'; // 'source' | 'dest'
  let modalBrowsingPath = '';
  let modalParentPath = null;

  function getTargetRate() {
    const checked = document.querySelector('input[name="targetRate"]:checked');
    return checked ? parseInt(checked.value, 10) : 44100;
  }

  function getTargetBitrate() {
    const checked = document.querySelector('input[name="targetBitrate"]:checked');
    return checked ? parseInt(checked.value, 10) : 320;
  }

  function isAlreadyMatching(fileObj, targetRate, targetBitrate) {
    const qc = fileObj.qc || {};
    const sr = qc.sample_rate_hz ? parseInt(qc.sample_rate_hz, 10) : 0;
    const br = qc.bitrate_kbps ? parseFloat(qc.bitrate_kbps) : 0;
    const rateMatch = sr === targetRate;
    const brMatch = fileObj.ext === '.mp3' && br > 0 && Math.abs(br - targetBitrate) <= 8;
    return rateMatch && brMatch;
  }

  function appendLog(level, message) {
    const p = document.createElement('p');
    p.className = 'log-line ' + level;
    p.textContent = message;
    terminalLogs.appendChild(p);
    terminalLogs.scrollTop = terminalLogs.scrollHeight;
  }

  function renderLogs(logs) {
    terminalLogs.replaceChildren();
    logs.forEach(msg => {
      const p = document.createElement('p');
      let lvl = 'info';
      if (msg.includes('ERROR') || msg.includes('Failed')) lvl = 'error';
      else if (msg.includes('SKIPPED')) lvl = 'warn';
      p.className = 'log-line ' + lvl;
      p.textContent = msg;
      terminalLogs.appendChild(p);
    });
    terminalLogs.scrollTop = terminalLogs.scrollHeight;
  }

  // 1. System status check
  async function fetchSystemStatus() {
    try {
      const res = await fetch('/api/system');
      if (!res.ok) return;
      const data = await res.json();
      if (data.ffmpeg && data.ffprobe) {
        ffmpegDot.className = 'status-indicator active';
        ffmpegVal.textContent = 'Ready';
      } else {
        ffmpegDot.className = 'status-indicator error';
        ffmpegVal.textContent = 'Missing';
      }
    } catch (err) {
      // Ignore transient error
    }
  }

  // 2. Fetch library and playlists
  async function fetchLibrary(customSource) {
    try {
      const targetSource = typeof customSource === 'string' ? customSource.trim() : currentSourceDir;
      const url = targetSource
        ? '/api/library?source_dir=' + encodeURIComponent(targetSource)
        : '/api/library';
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        appendLog('error', '[LIBRARY] ' + (data.error || 'Gagal memuat folder sumber.'));
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
    } catch (err) {
      appendLog('error', '[LIBRARY] Gagal memuat daftar lagu: ' + err.message);
      return false;
    }
  }

  // 3. Fast ffprobe scan for a playlist folder
  async function probeFolder(folderName) {
    if (probeStatusHint) {
      probeStatusHint.textContent = 'Memindai sample rate lagu dengan ffprobe...';
    }
    if (btnProbeCurrent) btnProbeCurrent.disabled = true;
    try {
      const payload = folderName === 'ALL' ? {} : { folder: folderName };
      if (currentSourceDir) payload.source_dir = currentSourceDir;
      const res = await fetch('/api/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        allFiles = data.files || [];
        allPlaylists = data.playlists || [];
        probedFolders.add(currentSourceDir + '::' + folderName);
        renderPlaylists();
        applyFiltersAndRenderTable();
        updateSelectionUI();
      }
    } catch (err) {
      appendLog('error', '[PROBE] Gagal membaca metadata: ' + err.message);
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

    // "Semua Koleksi" card
    const allCard = createPlaylistCard(
      'ALL',
      'Semua Koleksi (Inbox)',
      totalSongs + ' lagu total',
      totalMp3 + ' MP3'
    );
    playlistGrid.appendChild(allCard);

    allPlaylists.forEach(pl => {
      const displayLabel = pl.label || ('📁 ' + pl.name);
      const subText = pl.total + ' lagu';
      const badgeText = pl.mp3_count > 0 ? (pl.mp3_count + ' MP3') : (pl.other_count + ' Native');
      const card = createPlaylistCard(pl.name, displayLabel, subText, badgeText);
      playlistGrid.appendChild(card);
    });

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
      // Auto-probe this playlist if not yet probed (and reasonably sized)
      if (id !== 'ALL' && !probedFolders.has(currentSourceDir + '::' + id)) {
        probeFolder(id);
      }
    });

    return btn;
  }

  function updatePlaylistSummaryText() {
    const targetHz = getTargetRate();
    const targetBr = getTargetBitrate();
    const rateLabel = targetHz === 44100 ? '44.1 kHz' : '48 kHz';
    const specLabel = `${rateLabel} • ${targetBr} kbps`;
    const plLabel = activePlaylist === 'ALL'
      ? 'Semua Koleksi'
      : (activePlaylist === '__ROOT__' ? 'Root Inbox' : activePlaylist);

    if (activePlaylistSummary) {
      activePlaylistSummary.textContent = `Playlist Aktif: ${plLabel} → Target ${specLabel}`;
    }
    if (btnConvertPlaylistText) {
      btnConvertPlaylistText.textContent = activePlaylist === 'ALL'
        ? `Konversi Seluruh Koleksi → ${specLabel}`
        : `Konversi Playlist "${plLabel}" → ${specLabel}`;
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
      // Playlist filter
      if (activePlaylist === '__ROOT__') {
        if (f.folder !== '') return false;
      } else if (activePlaylist !== 'ALL') {
        const topFolder = (f.folder || '').split('/')[0];
        if (topFolder !== activePlaylist && f.folder !== activePlaylist) return false;
      }

      // Search filter
      if (query && !f.name.toLowerCase().includes(query) && !(f.folder || '').toLowerCase().includes(query)) {
        return false;
      }

      // Format filter
      if (fmtFilter !== 'ALL' && f.ext !== fmtFilter) {
        return false;
      }

      // Sample rate filter
      const qc = f.qc || {};
      const sr = qc.sample_rate_hz ? String(qc.sample_rate_hz) : '';
      if (rateFilter === 'NEEDS_CONVERT') {
        if (isAlreadyMatching(f, targetRate, targetBitrate)) return false;
      } else if (rateFilter !== 'ALL') {
        if (sr !== rateFilter) return false;
      }

      // Bitrate filter
      if (brFilter !== 'ALL') {
        const brNum = qc.bitrate_kbps ? parseFloat(qc.bitrate_kbps) : 0;
        const filterBrNum = parseInt(brFilter, 10);
        if (!brNum || Math.abs(brNum - filterBrNum) > 8) return false;
      }

      return true;
    });

    renderTableRows(targetRateStr);
    syncHeaderCheckbox();
  }

  function renderTableRows(targetRateStr) {
    converterTableBody.replaceChildren();

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

    visibleFiles.forEach((f, idx) => {
      const tr = document.createElement('tr');
      const isSelected = selectedPaths.has(f.rel_path);
      if (isSelected) tr.classList.add('row-selected');

      // 1. Checkbox cell
      const tdCheck = document.createElement('td');
      tdCheck.className = 'col-check';
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = isSelected;
      chk.setAttribute('aria-label', 'Pilih ' + f.name);

      chk.addEventListener('click', (e) => {
        e.stopPropagation();
        handleRowSelect(idx, f.rel_path, chk.checked, e.shiftKey);
      });

      tdCheck.appendChild(chk);
      tr.appendChild(tdCheck);

      // Allow clicking the row to toggle selection
      tr.addEventListener('click', (e) => {
        const newChecked = !selectedPaths.has(f.rel_path);
        handleRowSelect(idx, f.rel_path, newChecked, e.shiftKey);
      });

      // 2. File Name + Playlist badge
      const tdName = document.createElement('td');
      tdName.className = 'file-name-cell';
      const wrapper = document.createElement('div');
      wrapper.className = 'file-name-wrapper';

      if (f.folder) {
        const folderBadge = document.createElement('span');
        folderBadge.className = 'playlist-folder-badge';
        folderBadge.textContent = '📁 ' + f.folder;
        wrapper.appendChild(folderBadge);
      }

      const titleSpan = document.createElement('span');
      titleSpan.className = 'file-title-text';
      titleSpan.textContent = f.name;
      titleSpan.title = f.name;
      wrapper.appendChild(titleSpan);

      tdName.appendChild(wrapper);
      tr.appendChild(tdName);

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
      const targetBr = getTargetBitrate();
      const targetRateNum = getTargetRate();
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
      const targetLabel = `${targetRateStr === '44100' ? '44.1 kHz' : '48 kHz'} • ${targetBr} kbps`;
      if (!sr) {
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

      converterTableBody.appendChild(tr);
    });
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
    renderTableRows(String(getTargetRate()));
    syncHeaderCheckbox();
    updateSelectionUI();
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
    const rateLabel = getTargetRate() === 44100 ? '44.1 kHz' : '48 kHz';
    const brLabel = getTargetBitrate() + ' kbps';
    if (selectionCounterPill) {
      selectionCounterPill.textContent = `${count} lagu dipilih`;
    }
    if (btnConvertSelectedText) {
      btnConvertSelectedText.textContent = `Konversi Lagu Terpilih (${count}) → ${rateLabel} • ${brLabel}`;
    }
    if (btnConvertSelected) {
      btnConvertSelected.disabled = count === 0;
    }
  }

  // 6. Queue polling
  async function fetchQueueState() {
    try {
      const res = await fetch('/api/queue');
      if (!res.ok) return;
      const data = await res.json();

      const queueLen = (data.queue || []).length;
      queueCounter.textContent = 'Antrian: ' + queueLen;

      const current = data.current;
      if (current) {
        wasJobRunning = true;
        jobStatusTag.textContent = current.status || 'PROCESSING';
        jobStatusTag.className = 'job-status-tag active';
        jobUrlLabel.textContent = current.url;

        const p = Math.round(current.progress || 0);
        progressFill.style.width = p + '%';
        progressText.textContent = p + '% Complete';

        if (Array.isArray(current.logs) && current.logs.length > 0) {
          renderLogs(current.logs);
        }
      } else {
        jobStatusTag.textContent = 'IDLE';
        jobStatusTag.className = 'job-status-tag';
        if (queueLen === 0) {
          if (wasJobRunning) {
            wasJobRunning = false;
            progressFill.style.width = '100%';
            progressText.textContent = '100% Complete';
            // Show latest history logs if available
            if (Array.isArray(data.history) && data.history.length > 0 && Array.isArray(data.history[0].logs)) {
              renderLogs(data.history[0].logs);
            }
            fetchLibrary();
          }
        }
      }
    } catch (err) {
      // Ignore background poll error
    }
  }

  // 7. Event Listeners
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

  searchInput.addEventListener('input', () => {
    applyFiltersAndRenderTable();
  });

  filterFormat.addEventListener('change', () => {
    applyFiltersAndRenderTable();
  });

  filterRate.addEventListener('change', () => {
    applyFiltersAndRenderTable();
  });

  if (filterBitrate) {
    filterBitrate.addEventListener('change', () => {
      applyFiltersAndRenderTable();
    });
  }

  chkSelectAllVisible.addEventListener('change', () => {
    const check = chkSelectAllVisible.checked;
    visibleFiles.forEach(f => {
      if (check) selectedPaths.add(f.rel_path);
      else selectedPaths.delete(f.rel_path);
    });
    renderTableRows(String(getTargetRate()));
    syncHeaderCheckbox();
    updateSelectionUI();
  });

  btnSelectVisible.addEventListener('click', () => {
    visibleFiles.forEach(f => selectedPaths.add(f.rel_path));
    renderTableRows(String(getTargetRate()));
    syncHeaderCheckbox();
    updateSelectionUI();
  });

  btnSelectNeedConvert.addEventListener('click', () => {
    const targetRate = getTargetRate();
    const targetBitrate = getTargetBitrate();
    visibleFiles.forEach(f => {
      if (!isAlreadyMatching(f, targetRate, targetBitrate)) {
        selectedPaths.add(f.rel_path);
      }
    });
    renderTableRows(String(targetRate));
    syncHeaderCheckbox();
    updateSelectionUI();
  });

  btnClearSelection.addEventListener('click', () => {
    selectedPaths.clear();
    lastClickedIndex = null;
    renderTableRows(String(getTargetRate()));
    syncHeaderCheckbox();
    updateSelectionUI();
  });

  btnProbeCurrent.addEventListener('click', () => {
    probeFolder(activePlaylist);
  });

  // Source & Destination Folder Controls + Folder Browser Modal
  async function loadCustomSourceFolder(rawPath) {
    const cleanPath = (rawPath || '').trim();
    selectedPaths.clear();
    lastClickedIndex = null;
    activePlaylist = 'ALL';
    const ok = await fetchLibrary(cleanPath);
    if (ok) {
      appendLog('info', '[SOURCE] Memuat folder sumber: ' + currentSourceDir);
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
      appendLog('info', '[DESTINATION] Mode tujuan dikembalikan ke otomatis (folder baru di samping sumber).');
    });
  }

  async function browseTo(pathStr, createSubfolder) {
    if (!modalDirList) return;
    try {
      const payload = { path: pathStr || '' };
      if (createSubfolder) payload.create_subfolder = createSubfolder;
      const res = await fetch('/api/browse-dirs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        appendLog('error', '[BROWSER] ' + (data.error || 'Gagal membuka direktori.'));
        return;
      }

      modalBrowsingPath = data.current || '';
      modalParentPath = data.parent || null;
      if (modalCurrentPath) modalCurrentPath.textContent = modalBrowsingPath;
      if (btnModalUp) btnModalUp.disabled = !modalParentPath;

      // Render quick shortcuts
      if (modalShortcuts && Array.isArray(data.shortcuts)) {
        modalShortcuts.replaceChildren();
        data.shortcuts.forEach(sc => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn-chip';
          btn.textContent = sc.label;
          btn.title = sc.path;
          btn.addEventListener('click', () => browseTo(sc.path));
          modalShortcuts.appendChild(btn);
        });
      }

      // Render subdirectories
      modalDirList.replaceChildren();
      const dirs = data.dirs || [];
      if (dirs.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'modal-dir-empty';
        emptyMsg.textContent = 'Tidak ada subfolder di dalam direktori ini.';
        modalDirList.appendChild(emptyMsg);
      } else {
        dirs.forEach(d => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'modal-dir-item';

          const nameSpan = document.createElement('span');
          nameSpan.className = 'modal-dir-name';
          nameSpan.textContent = '📁 ' + d.name;

          const countSpan = document.createElement('span');
          countSpan.className = 'modal-dir-meta';
          countSpan.textContent = d.audio_count > 0 ? (d.audio_count + ' file audio') : 'Buka →';

          row.appendChild(nameSpan);
          row.appendChild(countSpan);
          row.addEventListener('click', () => browseTo(d.path));
          modalDirList.appendChild(row);
        });
      }
    } catch (err) {
      appendLog('error', '[BROWSER] Gagal memuat daftar folder: ' + err.message);
    }
  }

  function openFolderModal(mode) {
    modalTargetMode = mode;
    if (folderModalTitle) {
      folderModalTitle.textContent = mode === 'source'
        ? 'Pilih Folder Sumber (Source Audio)'
        : 'Pilih Folder Tujuan (Destination Hasil Konversi)';
    }
    if (newFolderNameInput) newFolderNameInput.value = '';
    const startPath = mode === 'source'
      ? (sourceDirInput && sourceDirInput.value.trim() ? sourceDirInput.value.trim() : currentSourceDir)
      : (destDirInput && destDirInput.value.trim() ? destDirInput.value.trim() : currentSourceDir);
    if (folderModal) folderModal.classList.remove('hidden');
    browseTo(startPath || '');
  }

  function closeFolderModal() {
    if (folderModal) folderModal.classList.add('hidden');
  }

  if (btnBrowseSource) {
    btnBrowseSource.addEventListener('click', () => openFolderModal('source'));
  }
  if (btnBrowseDest) {
    btnBrowseDest.addEventListener('click', () => openFolderModal('dest'));
  }
  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', closeFolderModal);
  }
  if (btnCancelModal) {
    btnCancelModal.addEventListener('click', closeFolderModal);
  }
  if (btnModalUp) {
    btnModalUp.addEventListener('click', () => {
      if (modalParentPath) browseTo(modalParentPath);
    });
  }
  if (btnCreateSubfolder && newFolderNameInput) {
    btnCreateSubfolder.addEventListener('click', () => {
      const subName = newFolderNameInput.value.trim();
      if (!subName) return;
      newFolderNameInput.value = '';
      browseTo(modalBrowsingPath, subName);
    });
  }
  if (btnSelectModalDir) {
    btnSelectModalDir.addEventListener('click', () => {
      if (!modalBrowsingPath) return;
      if (modalTargetMode === 'source') {
        if (sourceDirInput) sourceDirInput.value = modalBrowsingPath;
        closeFolderModal();
        loadCustomSourceFolder(modalBrowsingPath);
      } else {
        if (destDirInput) destDirInput.value = modalBrowsingPath;
        closeFolderModal();
        appendLog('info', '[DESTINATION] Folder tujuan disetel ke: ' + modalBrowsingPath);
      }
    });
  }

  // Convert Selected Songs (Batch Checkboxes)
  btnConvertSelected.addEventListener('click', async () => {
    if (selectedPaths.size === 0) return;
    const relPaths = Array.from(selectedPaths);
    const targetRate = getTargetRate();
    const targetBitrate = getTargetBitrate();
    const overwrite = optOverwrite ? optOverwrite.checked : false;
    const destDirVal = destDirInput && destDirInput.value.trim() ? destDirInput.value.trim() : null;

    btnConvertSelected.disabled = true;
    appendLog('info', `[DISPATCH] Menjadwalkan konversi ${relPaths.length} lagu terpilih ke ${targetRate} Hz • ${targetBitrate} kbps...`);

    try {
      const res = await fetch('/api/resample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_dir: currentSourceDir || null,
          dest_dir: destDirVal,
          rel_paths: relPaths,
          target_rate: targetRate,
          target_bitrate: targetBitrate,
          only_mp3: false,
          overwrite: overwrite
        })
      });
      const data = await res.json();
      if (res.ok) {
        appendLog('info', '[QUEUE] ' + data.message);
        fetchQueueState();
      } else {
        appendLog('error', '[ERROR] ' + (data.error || 'Gagal menjadwalkan konversi.'));
        btnConvertSelected.disabled = false;
      }
    } catch (err) {
      appendLog('error', '[NETWORK ERROR] ' + err.message);
      btnConvertSelected.disabled = false;
    }
  });

  // Convert Entire Active Playlist
  btnConvertPlaylist.addEventListener('click', async () => {
    const targetRate = getTargetRate();
    const targetBitrate = getTargetBitrate();
    const onlyMp3 = optOnlyMp3 ? optOnlyMp3.checked : true;
    const overwrite = optOverwrite ? optOverwrite.checked : false;
    const playlistArg = activePlaylist === 'ALL' ? null : activePlaylist;
    const destDirVal = destDirInput && destDirInput.value.trim() ? destDirInput.value.trim() : null;

    btnConvertPlaylist.disabled = true;
    appendLog('info', `[DISPATCH] Menjadwalkan konversi playlist (${activePlaylist}) ke ${targetRate} Hz • ${targetBitrate} kbps...`);

    try {
      const res = await fetch('/api/resample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_dir: currentSourceDir || null,
          dest_dir: destDirVal,
          playlist: playlistArg,
          target_rate: targetRate,
          target_bitrate: targetBitrate,
          only_mp3: onlyMp3,
          overwrite: overwrite
        })
      });
      const data = await res.json();
      if (res.ok) {
        appendLog('info', '[QUEUE] ' + data.message);
        fetchQueueState();
      } else {
        appendLog('error', '[ERROR] ' + (data.error || 'Gagal menjadwalkan konversi playlist.'));
      }
    } catch (err) {
      appendLog('error', '[NETWORK ERROR] ' + err.message);
    } finally {
      setTimeout(() => {
        btnConvertPlaylist.disabled = false;
      }, 1000);
    }
  });

  btnClearLogs.addEventListener('click', () => {
    terminalLogs.replaceChildren();
  });

  // Initialize
  fetchSystemStatus();
  fetchLibrary().then(() => {
    // Auto-select first playlist with MP3 files if available, and probe it
    const mp3Playlist = allPlaylists.find(p => p.mp3_count > 0);
    if (mp3Playlist) {
      activePlaylist = mp3Playlist.name;
      renderPlaylists();
      applyFiltersAndRenderTable();
      probeFolder(mp3Playlist.name);
    }
  });
  fetchQueueState();

  setInterval(() => {
    fetchQueueState();
  }, 1500);
});

