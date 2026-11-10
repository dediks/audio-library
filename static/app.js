/**
 * SWARARIA AUDIO LAB - Stage 1: Batch Audio Ingestion Client Logic
 * Strict DOM Manipulation (No innerHTML, strictly textContent & createElement)
 */

import {
  initAppHeader,
  apiGet,
  apiPost,
  appendLog,
  renderLogs,
  setLogFilter,
  notify,
  createQueueMonitor,
  openFolderInExplorer,
} from './modules/ui-shared.js';

document.addEventListener('DOMContentLoaded', () => {
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

  const inboxTotalSongsPill = document.getElementById('inboxTotalSongsPill');
  const inboxTotalPlaylistsPill = document.getElementById('inboxTotalPlaylistsPill');
  const btnOpenInboxExplorer = document.getElementById('btnOpenInboxExplorer');

  let currentInboxDir = '';

  function log(level, message) {
    appendLog(terminalLogs, level, message);
  }

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
          noticeDesc.textContent = 'Pasang FFmpeg agar sistem dapat mengaudit headroom True Peak (dBTP) dan Frequency Spectrum:';
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

  // 2. Refresh Inbox Summary Counters
  async function refreshInboxSummary() {
    const { ok, data } = await apiGet('/api/library');
    if (!ok || !data) return;
    currentInboxDir = data.source_dir || '';
    const files = data.files || [];
    const playlists = (data.playlists || []).filter(p => p.name !== '__ROOT__');
    if (inboxTotalSongsPill) {
      inboxTotalSongsPill.textContent = `${files.length} Lagu di Inbox`;
    }
    if (inboxTotalPlaylistsPill) {
      inboxTotalPlaylistsPill.textContent = `${playlists.length} Folder Playlist`;
    }
  }

  // 3. Queue and Live Logs Monitor
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
      refreshInboxSummary();
    },
    onIdle: (justFinished) => {
      btnStartIngest.disabled = false;
      btnStartIngest.classList.remove('running');
      if (justFinished) {
        progressFill.style.width = '100%';
        progressText.textContent = '100% Complete';
        refreshInboxSummary();
      }
    },
  });

  // 4. Format Spec Banner
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
        if (specText) specText.textContent = 'Target: Native Raw Stream — Format mentah asli YouTube (.webm / .m4a) tanpa remux (Anti-DRC, 4x Multi-thread)';
        if (specDot) specDot.style.backgroundColor = 'var(--accent-cyan)';
      } else {
        if (specText) specText.textContent = 'Target: Opus Best Quality (.opus) — Lossless Remux 48 kHz + Cover Art HD (Anti-DRC, 4x Multi-thread)';
        if (specDot) specDot.style.backgroundColor = '#10b981';
      }
    } else if (val === 'mp3_320k') {
      const opusSuffix = keepOpus ? ' + Simpan File Asli Opus (.webm)' : '';
      if (specText) specText.textContent = 'Target: MP3 320 kbps CBR' + opusSuffix + ' (KONVERSI lossy, 4x Multi-thread)';
      if (specDot) specDot.style.backgroundColor = 'var(--accent-amber)';
    } else if (val === 'mp3_vbr0') {
      const opusSuffix = keepOpus ? ' + Simpan File Asli Opus (.webm)' : '';
      if (specText) specText.textContent = 'Target: MP3 VBR 0' + opusSuffix + ' (KONVERSI lossy, 4x Multi-thread)';
      if (specDot) specDot.style.backgroundColor = '#c084fc';
    }
  }

  formatRadios.forEach(radio => {
    radio.addEventListener('change', updateFormatSpecBanner);
  });
  if (optKeepOpus) optKeepOpus.addEventListener('change', updateFormatSpecBanner);
  if (optRawWebm) optRawWebm.addEventListener('change', updateFormatSpecBanner);
  updateFormatSpecBanner();

  // 5. Submit Batch Ingestion Form
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
        type: data?.duplicate_count > 0 ? 'exists' : 'error',
        title: data?.duplicate_count > 0 ? 'URL Sudah Dalam Antrian' : 'Gagal Menambahkan Unduhan',
        message: errMsg,
        playSound: true,
      });
      btnStartIngest.disabled = false;
    }
  });

  // 6. YouTube Music In-App Search
  const ytmSearchInput = document.getElementById('ytmSearchInput');
  const btnClearSearchInput = document.getElementById('btnClearSearchInput');
  const btnYtmSearch = document.getElementById('btnYtmSearch');
  const searchSpinner = document.getElementById('searchSpinner');
  const searchText = document.getElementById('searchText');
  const searchTypeChips = document.getElementById('searchTypeChips');
  const ytmResultsPanel = document.getElementById('ytmResultsPanel');
  const resultsCountBadge = document.getElementById('resultsCountBadge');
  const resultsQueryBadge = document.getElementById('resultsQueryBadge');
  const btnSelectAllResults = document.getElementById('btnSelectAllResults');
  const btnAddSelectedResults = document.getElementById('btnAddSelectedResults');
  const btnCloseResults = document.getElementById('btnCloseResults');
  const ytmResultsList = document.getElementById('ytmResultsList');
  const btnClearUrls = document.getElementById('btnClearUrls');

  let currentSearchType = 'songs';
  let currentSearchResults = [];
  let isAllSelected = false;

  function normalizeYtUrl(url) {
    if (!url) return '';
    return url.replace(/([?&]list=)VL([a-zA-Z0-9_-]+)/g, '$1$2');
  }

  function appendUrlToInput(url) {
    if (!url) return;
    const clean = normalizeYtUrl(url);
    const current = urlInput.value.trim();
    if (!current) {
      urlInput.value = clean;
    } else {
      const existing = current.split('\n').map(l => l.trim());
      if (!existing.includes(clean)) {
        urlInput.value = current + '\n' + clean;
      }
    }
  }

  if (btnClearUrls) {
    btnClearUrls.addEventListener('click', () => {
      urlInput.value = '';
      urlInput.focus();
    });
  }

  if (searchTypeChips) {
    const chips = searchTypeChips.querySelectorAll('.search-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        currentSearchType = chip.dataset.type || 'songs';
        const q = ytmSearchInput ? ytmSearchInput.value.trim() : '';
        if (q && ytmResultsPanel && !ytmResultsPanel.classList.contains('hidden')) {
          performSearch(q);
        }
      });
    });
  }

  if (ytmSearchInput && btnClearSearchInput) {
    ytmSearchInput.addEventListener('input', () => {
      btnClearSearchInput.classList.toggle('hidden', !ytmSearchInput.value);
    });
    btnClearSearchInput.addEventListener('click', (e) => {
      e.preventDefault();
      ytmSearchInput.value = '';
      btnClearSearchInput.classList.add('hidden');
      if (ytmResultsPanel) ytmResultsPanel.classList.add('hidden');
      ytmSearchInput.focus();
    });
    ytmSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const q = ytmSearchInput.value.trim();
        if (q) {
          performSearch(q);
        } else {
          ytmSearchInput.focus();
          notify({
            type: 'warning',
            title: 'Kata Kunci Kosong',
            message: 'Silakan ketik judul lagu, musisi, atau playlist sebelum mencari.',
          });
        }
      }
    });
  }

  if (btnYtmSearch) {
    btnYtmSearch.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const q = ytmSearchInput ? ytmSearchInput.value.trim() : '';
      if (q) {
        performSearch(q);
      } else {
        if (ytmSearchInput) ytmSearchInput.focus();
        notify({
          type: 'warning',
          title: 'Kata Kunci Kosong',
          message: 'Silakan ketik judul lagu, musisi, atau playlist sebelum mencari.',
        });
      }
    });
  }

  if (btnCloseResults) {
    btnCloseResults.addEventListener('click', (e) => {
      e.preventDefault();
      if (ytmResultsPanel) ytmResultsPanel.classList.add('hidden');
    });
  }

  if (btnSelectAllResults) {
    btnSelectAllResults.addEventListener('click', (e) => {
      e.preventDefault();
      isAllSelected = !isAllSelected;
      if (ytmResultsList) {
        const checkboxes = ytmResultsList.querySelectorAll('.result-checkbox');
        checkboxes.forEach(cb => { cb.checked = isAllSelected; });
      }
      btnSelectAllResults.textContent = isAllSelected ? 'Batal Pilih' : 'Pilih Semua';
    });
  }

  if (btnAddSelectedResults) {
    btnAddSelectedResults.addEventListener('click', (e) => {
      e.preventDefault();
      if (!ytmResultsList) return;
      const checkboxes = ytmResultsList.querySelectorAll('.result-checkbox:checked');
      if (checkboxes.length === 0) {
        notify({
          type: 'warning',
          title: 'Tidak Ada Lagu Dipilih',
          message: 'Centang kotak pada lagu yang ingin dimasukkan ke antrean.',
        });
        return;
      }
      let addedCount = 0;
      checkboxes.forEach(cb => {
        const itemUrl = cb.dataset.url;
        if (itemUrl) {
          appendUrlToInput(itemUrl);
          addedCount++;
        }
      });
      notify({
        type: 'info',
        title: 'URL Berhasil Ditambahkan',
        message: `${addedCount} link YouTube Music telah dimasukkan ke daftar antrean.`,
      });
      if (ytmResultsPanel) ytmResultsPanel.classList.add('hidden');
    });
  }

  async function performSearch(query) {
    if (!query) return;
    if (searchSpinner) searchSpinner.classList.remove('hidden');
    if (searchText) searchText.textContent = 'Mencari...';
    if (btnYtmSearch) btnYtmSearch.disabled = true;

    // Immediately display interactive loading drawer
    if (ytmResultsPanel) {
      ytmResultsPanel.classList.remove('hidden');
      if (resultsCountBadge) resultsCountBadge.textContent = 'Mencari...';
      if (resultsQueryBadge) resultsQueryBadge.textContent = `"${query}"`;
    }
    if (ytmResultsList) {
      ytmResultsList.replaceChildren();
      const loadingDiv = document.createElement('div');
      loadingDiv.className = 'results-empty-state';
      const sp = document.createElement('span');
      sp.className = 'spinner-small';
      sp.style.marginRight = '8px';
      const text = document.createElement('span');
      text.textContent = `Sedang mencari "${query}" di YouTube Music...`;
      loadingDiv.appendChild(sp);
      loadingDiv.appendChild(text);
      ytmResultsList.appendChild(loadingDiv);
    }

    const useCookies = optUseCookies ? optUseCookies.checked : true;
    const { ok, data, error } = await apiPost('/api/search', {
      query,
      type: currentSearchType,
      limit: 15,
      use_cookies: useCookies,
    });

    if (searchSpinner) searchSpinner.classList.add('hidden');
    if (searchText) searchText.textContent = 'Cari Musik';
    if (btnYtmSearch) btnYtmSearch.disabled = false;

    if (ok && data) {
      currentSearchResults = data.results || [];
      renderSearchResults(currentSearchResults, query);
    } else {
      const errMsg = error || 'Gagal memuat hasil pencarian.';
      if (ytmResultsList) {
        ytmResultsList.replaceChildren();
        const errDiv = document.createElement('div');
        errDiv.className = 'results-empty-state';
        errDiv.style.color = 'var(--accent-red)';
        const errText = document.createElement('span');
        errText.textContent = `Gagal: ${errMsg}`;
        errDiv.appendChild(errText);
        ytmResultsList.appendChild(errDiv);
      }
      notify({
        type: 'error',
        title: 'Pencarian Gagal',
        message: errMsg,
      });
    }
  }

  function renderSearchResults(items, query) {
    if (!ytmResultsList || !ytmResultsPanel) return;
    ytmResultsList.replaceChildren();
    isAllSelected = false;
    if (btnSelectAllResults) btnSelectAllResults.textContent = 'Pilih Semua';

    if (resultsCountBadge) {
      resultsCountBadge.textContent = `${items.length} hasil`;
    }
    if (resultsQueryBadge) {
      resultsQueryBadge.textContent = `"${query}"`;
    }

    if (items.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'results-empty-state';
      const emptyText = document.createElement('span');
      emptyText.textContent = `Tidak ditemukan hasil untuk "${query}". Coba kata kunci lain atau pilih tab 'Semua'.`;
      emptyDiv.appendChild(emptyText);
      ytmResultsList.appendChild(emptyDiv);
      ytmResultsPanel.classList.remove('hidden');
      return;
    }

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'search-result-item';

      // Checkbox
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'result-checkbox';
      cb.dataset.url = item.url;
      card.appendChild(cb);

      // Thumbnail
      if (item.thumbnail) {
        const img = document.createElement('img');
        img.className = 'result-thumb';
        img.src = item.thumbnail;
        img.alt = item.title || 'Cover';
        img.loading = 'lazy';
        img.onerror = () => { img.style.display = 'none'; };
        card.appendChild(img);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'result-thumb-placeholder';
        placeholder.textContent = '♪';
        card.appendChild(placeholder);
      }

      // Info
      const info = document.createElement('div');
      info.className = 'result-info';

      const titleRow = document.createElement('div');
      titleRow.className = 'result-title-row';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'result-title';
      titleSpan.textContent = item.title;
      titleRow.appendChild(titleSpan);

      const typeBadge = document.createElement('span');
      typeBadge.className = `result-type-badge ${item.type || 'song'}`;
      typeBadge.textContent = (item.type || 'song').toUpperCase();
      titleRow.appendChild(typeBadge);

      info.appendChild(titleRow);

      const metaRow = document.createElement('div');
      metaRow.className = 'result-meta-row';

      if (item.artist) {
        const artistSpan = document.createElement('span');
        artistSpan.className = 'result-artist';
        artistSpan.textContent = item.artist + (item.album ? ` • ${item.album}` : '');
        metaRow.appendChild(artistSpan);
      }

      if (item.duration) {
        const durSpan = document.createElement('span');
        durSpan.className = 'result-duration';
        durSpan.textContent = item.duration;
        metaRow.appendChild(durSpan);
      }

      info.appendChild(metaRow);
      card.appendChild(info);

      // Actions
      const actions = document.createElement('div');
      actions.className = 'result-actions';

      const btnEnqueue = document.createElement('button');
      btnEnqueue.type = 'button';
      btnEnqueue.className = 'btn-result-enqueue';
      btnEnqueue.textContent = '+ Ke Antrean';
      btnEnqueue.title = 'Tambahkan link ini ke daftar URL';
      btnEnqueue.addEventListener('click', (ev) => {
        ev.stopPropagation();
        appendUrlToInput(item.url);
        btnEnqueue.textContent = '✓ Ditambahkan';
        setTimeout(() => { btnEnqueue.textContent = '+ Ke Antrean'; }, 1500);
        notify({
          type: 'info',
          title: 'Trek Ditambahkan',
          message: `"${item.title}" ditambahkan ke kotak URL.`,
        });
      });
      actions.appendChild(btnEnqueue);

      const btnDownload = document.createElement('button');
      btnDownload.type = 'button';
      btnDownload.className = 'btn-result-download';
      btnDownload.textContent = '⚡ Unduh';
      btnDownload.title = 'Langsung unduh trek ini';
      btnDownload.addEventListener('click', (ev) => {
        ev.stopPropagation();
        urlInput.value = normalizeYtUrl(item.url);
        if (item.type === 'playlist' && optPlaylist) {
          optPlaylist.checked = true;
        }
        ytmResultsPanel.classList.add('hidden');
        form.requestSubmit();
      });
      actions.appendChild(btnDownload);

      card.appendChild(actions);
      ytmResultsList.appendChild(card);
    });

    ytmResultsPanel.classList.remove('hidden');
  }

  if (btnOpenInboxExplorer) {
    btnOpenInboxExplorer.addEventListener('click', () => {
      openFolderInExplorer('', currentInboxDir);
    });
  }

  if (btnClearLogs) {
    btnClearLogs.addEventListener('click', () => {
      terminalLogs.replaceChildren();
    });
  }

  const btnLogFilterAll = document.getElementById('btnLogFilterAll');
  const btnLogFilterErrors = document.getElementById('btnLogFilterErrors');
  if (btnLogFilterAll && btnLogFilterErrors) {
    btnLogFilterAll.addEventListener('click', () => {
      btnLogFilterAll.classList.add('active');
      btnLogFilterErrors.classList.remove('active');
      setLogFilter('all');
    });
    btnLogFilterErrors.addEventListener('click', () => {
      btnLogFilterErrors.classList.add('active');
      btnLogFilterAll.classList.remove('active');
      setLogFilter('errors');
    });
  }

  queueMonitor.poll();
  refreshInboxSummary();
  setInterval(() => {
    queueMonitor.poll();
  }, 2000);
});
