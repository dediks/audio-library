/**
 * SWARARIA AUDIO LAB - Stage 1: Batch Audio Ingestion Client Logic
 * Strict DOM Manipulation (No innerHTML, strictly textContent & createElement)
 *
 * UX flow:  1) Omnibox (search OR paste URLs)  ->  2) Staging list (visual cards)
 *           ->  3) Format + collapsible advanced options  ->  Sticky "Start" action bar.
 * Right column renders the queue per-item (active / waiting / recent) from /api/queue,
 * with the raw extraction log tucked into a collapsible panel.
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

const STAGING_KEY = 'ingest_staging_v1';
const SETTINGS_KEY = 'ingest_settings_v1';
const META_KEY = 'ingest_url_meta_v1';
const MAX_STAGING = 300;
const MAX_META = 200;
const ALLOWED_HOSTS = ['youtube.com', 'youtu.be'];

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function clampStr(val, max = 300) {
  return typeof val === 'string' ? val.slice(0, max) : '';
}

/** Mirrors backend normalization: strip internal 'VL' prefix from YT Music playlist IDs. */
function normalizeYtUrl(url) {
  if (!url) return '';
  return url.trim().replace(/([?&]list=)VL([a-zA-Z0-9_-]+)/g, '$1$2');
}

/** Client-side allow-list check (backend re-validates authoritatively). */
function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return ALLOWED_HOSTS.some(d => host === d || host.endsWith('.' + d));
  } catch (_) {
    return false;
  }
}

/** Only allow https image sources for thumbnails. */
function safeImageUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.href : '';
  } catch (_) {
    return '';
  }
}

function extractUrls(text) {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s<>"'`]+/gi) || [];
  return matches.map(m => m.replace(/[),.;]+$/, ''));
}

function describeUrl(url) {
  try {
    const u = new URL(url);
    const list = u.searchParams.get('list');
    const v = u.searchParams.get('v') || (u.hostname.endsWith('youtu.be') ? u.pathname.slice(1) : '');
    const isMusic = u.hostname.startsWith('music.');
    if (list && !v) return { kind: 'playlist', label: `Playlist ${list.slice(0, 18)}`, source: isMusic ? 'YouTube Music' : 'YouTube' };
    if (v) return { kind: 'video', label: `Video ${v.slice(0, 15)}`, source: isMusic ? 'YouTube Music' : 'YouTube', extra: list ? 'dalam playlist' : '' };
    return { kind: 'video', label: u.hostname + u.pathname, source: 'YouTube' };
  } catch (_) {
    return { kind: 'video', label: url, source: '' };
  }
}

function formatAgo(ts) {
  if (!ts) return '';
  const diff = Math.max(0, Date.now() / 1000 - Number(ts));
  if (diff < 45) return 'baru saja';
  if (diff < 3600) return `${Math.round(diff / 60)} mnt lalu`;
  if (diff < 86400) return `${Math.round(diff / 3600)} jam lalu`;
  return `${Math.round(diff / 86400)} hari lalu`;
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    // Storage full / disabled: non-critical
  }
}

/** Sanitizes an item coming from search results, paste, or localStorage. */
function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const url = normalizeYtUrl(clampStr(raw.url, 600));
  if (!isAllowedUrl(url)) return null;
  const desc = describeUrl(url);
  const kindRaw = clampStr(raw.kind || raw.type, 20).toLowerCase();
  const kind = ['song', 'video', 'playlist', 'album'].includes(kindRaw) ? kindRaw : desc.kind;
  return {
    url,
    title: clampStr(raw.title, 200),
    artist: clampStr(raw.artist, 200),
    album: clampStr(raw.album, 200),
    duration: clampStr(raw.duration, 16),
    track_count: clampStr(raw.track_count, 40),
    audio_tier: clampStr(raw.audio_tier, 20),
    thumbnail: safeImageUrl(clampStr(raw.thumbnail, 800)),
    kind,
  };
}

/**
 * Formats artist and album subtitle, suppressing the album if redundant with the title (e.g. single releases).
 */
function formatItemSubtitle(item) {
  if (!item) return '';
  const artist = (item.artist || '').trim();
  const album = (item.album || '').trim();
  const title = (item.title || '').trim();

  if (!album) return artist;
  if (!artist) return album;
  if (!title) return `${artist} · ${album}`;

  const clean = (s) =>
    s
      .toLowerCase()
      .replace(/\s*-\s*(?:single|ep)\b/gi, '')
      .replace(/\s*\((?:feat\.|ft\.|featuring|with|instrumental|remix|version|live|official|audio|single|ep)[^)]*\)/gi, '')
      .replace(/\s*\[(?:feat\.|ft\.|featuring|with|instrumental|remix|version|live|official|audio|single|ep)[^\]]*\]/gi, '')
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const cTitle = clean(title);
  const cAlbum = clean(album);

  if (cTitle && cAlbum && (cTitle === cAlbum || cTitle.startsWith(cAlbum) || cAlbum.startsWith(cTitle))) {
    return artist;
  }

  return `${artist} · ${album}`;
}

/* ------------------------------------------------------------------ */
/* Page logic                                                          */
/* ------------------------------------------------------------------ */

document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);

  // Omnibox
  const omniInput = $('omniInput');
  const omniIcon = $('omniIcon');
  const btnOmniClear = $('btnOmniClear');
  const btnOmniSubmit = $('btnOmniSubmit');
  const omniSpinner = $('omniSpinner');
  const omniSubmitText = $('omniSubmitText');
  const omniHint = $('omniHint');
  const searchTypeChips = $('searchTypeChips');

  // Input Mode Tabs (Search vs Manual URL)
  const tabModeSearch = $('tabModeSearch');
  const tabModeManual = $('tabModeManual');
  const searchModeContainer = $('searchModeContainer');
  const manualModeContainer = $('manualModeContainer');
  const manualUrlInput = $('manualUrlInput');
  const btnClearManualUrls = $('btnClearManualUrls');
  const btnAddManualUrls = $('btnAddManualUrls');
  const manualCountHint = $('manualCountHint');

  // Results
  const ytmResultsPanel = $('ytmResultsPanel');
  const ytmResultsList = $('ytmResultsList');
  const resultsTitle = $('resultsTitle');
  const resultsSortSelect = $('resultsSortSelect');
  const resultsFoot = $('resultsFoot');
  const btnLoadMoreResults = $('btnLoadMoreResults');
  const loadMoreSpinner = $('loadMoreSpinner');
  const loadMoreText = $('loadMoreText');
  const btnAddAllResults = $('btnAddAllResults');
  const btnCloseResults = $('btnCloseResults');

  // Preview Player Dock
  const ingPreviewDock = $('ingPreviewDock');
  const ingPreviewThumb = $('ingPreviewThumb');
  const ingPreviewSpinner = $('ingPreviewSpinner');
  const ingPreviewBadgeText = $('ingPreviewBadgeText');
  const ingPreviewTitle = $('ingPreviewTitle');
  const ingPreviewArtist = $('ingPreviewArtist');
  const ingPreviewAudio = $('ingPreviewAudio');
  const btnPreviewStage = $('btnPreviewStage');
  const btnPreviewDownloadNow = $('btnPreviewDownloadNow');
  const btnPreviewExternal = $('btnPreviewExternal');
  const btnClosePreview = $('btnClosePreview');

  // Staging
  const stagingList = $('stagingList');
  const stagingEmpty = $('stagingEmpty');
  const stagingCount = $('stagingCount');
  const btnClearStaging = $('btnClearStaging');

  // Settings
  const formatRadios = document.querySelectorAll('input[name="audioFormat"]');
  const optRawWebm = $('optRawWebm');
  const optKeepOpus = $('optKeepOpus');
  const optPlaylist = $('optPlaylist');
  const optAutoScan = $('optAutoScan');
  const optUseCookies = $('optUseCookies');
  const rawWebmToggleWrap = $('rawWebmToggleWrap');
  const keepOpusToggleWrap = $('keepOpusToggleWrap');
  const advancedPanel = $('advancedPanel');
  const advancedSummary = $('advancedSummary');
  const specText = $('specText');
  const specDot = $('specDot');

  // Action bar
  const btnStartIngest = $('btnStartIngest');
  const btnStartText = $('btnStartText');
  const actionSummaryMain = $('actionSummaryMain');
  const actionSummarySub = $('actionSummarySub');

  // Monitor
  const systemNoticeCard = $('systemNoticeCard');
  const noticeTitle = $('noticeTitle');
  const noticeDesc = $('noticeDesc');
  const noticeCode = $('noticeCode');
  const queueCounter = $('queueCounter');
  const statActive = $('statActive');
  const activeJobBox = $('activeJobBox');
  const activeJobArt = $('activeJobArt');
  const activeJobTitle = $('activeJobTitle');
  const jobStatusTag = $('jobStatusTag');
  const jobUrlLabel = $('jobUrlLabel');
  const progressFill = $('progressFill');
  const progressText = $('progressText');
  const progressBar = $('progressBar');
  const waitingList = $('waitingList');
  const waitingEmpty = $('waitingEmpty');
  const historyList = $('historyList');
  const historyEmpty = $('historyEmpty');
  const terminalLogs = $('terminalLogs');
  const btnClearLogs = $('btnClearLogs');

  // Inbox hub
  const inboxTotalSongsPill = $('inboxTotalSongsPill');
  const inboxTotalPlaylistsPill = $('inboxTotalPlaylistsPill');
  const btnOpenInboxExplorer = $('btnOpenInboxExplorer');

  let currentInboxDir = '';
  let currentSearchType = 'songs';
  let currentResults = [];
  let isSubmitting = false;
  let lastMonitorSignature = '';

  /** @type {ReturnType<typeof sanitizeItem>[]} */
  let staging = (readJson(STAGING_KEY, []) || []).map(sanitizeItem).filter(Boolean).slice(0, MAX_STAGING);
  let urlMeta = readJson(META_KEY, {});
  if (!urlMeta || typeof urlMeta !== 'object' || Array.isArray(urlMeta)) urlMeta = {};

  function log(level, message) {
    appendLog(terminalLogs, level, message);
  }

  /* ---------------- System header ---------------- */
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

  /* ---------------- URL metadata cache (for queue display) ---------------- */
  function rememberMeta(item) {
    if (!item || !item.title) return;
    urlMeta[item.url] = { title: item.title, artist: item.artist, thumbnail: item.thumbnail, t: Date.now() };
    const keys = Object.keys(urlMeta);
    if (keys.length > MAX_META) {
      keys.sort((a, b) => (urlMeta[a].t || 0) - (urlMeta[b].t || 0))
        .slice(0, keys.length - MAX_META)
        .forEach(k => delete urlMeta[k]);
    }
    writeJson(META_KEY, urlMeta);
  }

  function metaFor(url) {
    const m = urlMeta[url];
    if (!m || typeof m !== 'object') return null;
    return {
      title: clampStr(m.title, 200),
      artist: clampStr(m.artist, 200),
      thumbnail: safeImageUrl(clampStr(m.thumbnail, 800)),
    };
  }

  /* ---------------- Thumbnails ---------------- */
  function createThumb(src, className, fallbackGlyph = '♪') {
    const wrap = el('div', className);
    const safe = safeImageUrl(src);
    if (safe) {
      const img = document.createElement('img');
      img.src = safe;
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => {
        img.remove();
        wrap.textContent = fallbackGlyph;
      });
      wrap.appendChild(img);
    } else {
      wrap.textContent = fallbackGlyph;
    }
    return wrap;
  }

  const KIND_LABEL = { song: 'Lagu', video: 'Video', playlist: 'Playlist', album: 'Album' };

  /* ---------------- Staging list ---------------- */
  function isStaged(url) {
    return staging.some(s => s.url === url);
  }

  function saveStaging() {
    writeJson(STAGING_KEY, staging);
  }

  /** Adds items; returns { added, duplicate, invalid }. */
  function addToStaging(rawItems) {
    const res = { added: 0, duplicate: 0, invalid: 0 };
    rawItems.forEach(raw => {
      const item = sanitizeItem(raw);
      if (!item) { res.invalid++; return; }
      if (isStaged(item.url)) { res.duplicate++; return; }
      if (staging.length >= MAX_STAGING) { res.invalid++; return; }
      staging.push(item);
      rememberMeta(item);
      res.added++;
    });
    if (res.added) {
      saveStaging();
      renderStaging();
      syncResultButtons();
    }
    return res;
  }

  function removeFromStaging(url) {
    staging = staging.filter(s => s.url !== url);
    saveStaging();
    renderStaging();
    syncResultButtons();
  }

  function renderStaging() {
    stagingList.replaceChildren();
    const count = staging.length;
    stagingCount.textContent = String(count);
    stagingEmpty.classList.toggle('hidden', count > 0);
    stagingList.classList.toggle('hidden', count === 0);
    btnClearStaging.classList.toggle('hidden', count === 0);

    staging.forEach((item, idx) => {
      const desc = describeUrl(item.url);
      const row = el('div', 'ing-stage-item');
      row.setAttribute('role', 'listitem');

      row.appendChild(el('span', 'ing-stage-idx', String(idx + 1).padStart(2, '0')));
      row.appendChild(createThumb(item.thumbnail, 'ing-thumb', item.kind === 'playlist' || item.kind === 'album' ? '≡' : '♪'));

      const info = el('div', 'ing-stage-info');
      info.appendChild(el('div', 'ing-stage-title', item.title || desc.label));
      const meta = el('div', 'ing-stage-meta');
      if (item.kind === 'song') {
        const badge = el('span', 'ing-kind hq-master', '✨ HQ Audio');
        badge.title = 'Katalog Master Studio Resmi (Native Opus 48kHz / AAC)';
        meta.appendChild(badge);
      } else if (item.kind === 'video') {
        meta.appendChild(el('span', 'ing-kind video', '🎬 Video Audio'));
      } else {
        meta.appendChild(el('span', `ing-kind ${item.kind}`, KIND_LABEL[item.kind] || 'Video'));
      }
      const subText = item.title
        ? formatItemSubtitle(item)
        : [desc.source, desc.extra].filter(Boolean).join(' · ');
      if (subText) meta.appendChild(el('span', 'ing-stage-sub', subText));
      if (item.duration) meta.appendChild(el('span', 'ing-stage-dur mono-stat', item.duration));
      info.appendChild(meta);
      info.title = item.url;
      row.appendChild(info);

      const btnRemove = el('button', 'ing-icon-btn ing-stage-remove', '×');
      btnRemove.type = 'button';
      btnRemove.title = 'Hapus dari daftar';
      btnRemove.setAttribute('aria-label', `Hapus ${item.title || desc.label} dari daftar`);
      btnRemove.addEventListener('click', () => removeFromStaging(item.url));
      row.appendChild(btnRemove);

      stagingList.appendChild(row);
    });

    updateActionBar();
  }

  btnClearStaging.addEventListener('click', () => {
    const prev = staging.slice();
    staging = [];
    saveStaging();
    renderStaging();
    syncResultButtons();
    notify({
      type: 'info',
      title: 'Daftar dikosongkan',
      message: `${prev.length} item dihapus dari daftar unduhan.`,
    });
  });

  /* ---------------- Omnibox ---------------- */
  function omniMode() {
    return extractUrls(omniInput.value).length > 0 ? 'url' : 'search';
  }

  function updateOmniMode() {
    const mode = omniMode();
    const hasText = omniInput.value.length > 0;
    btnOmniClear.classList.toggle('hidden', !hasText);
    omniSubmitText.textContent = mode === 'url' ? 'Tambah' : 'Cari';
    omniIcon.dataset.mode = mode;
    searchTypeChips.classList.toggle('is-muted', mode === 'url');
    omniHint.textContent = mode === 'url'
      ? 'Enter untuk menambahkan URL ke daftar'
      : 'Enter untuk cari · tempel URL langsung masuk daftar';
  }

  function reportAddResult(res, sourceLabel) {
    if (res.added === 0 && res.duplicate === 0 && res.invalid === 0) return;
    const notes = [];
    if (res.duplicate) notes.push(`${res.duplicate} sudah ada di daftar`);
    if (res.invalid) notes.push(`${res.invalid} bukan URL YouTube valid`);
    notify({
      type: res.added ? (notes.length ? 'warning' : 'info') : 'warning',
      title: res.added ? `${res.added} ${sourceLabel} ditambahkan` : 'Tidak ada yang ditambahkan',
      message: notes.length ? notes.join(' · ') : 'Siap diunduh dari daftar.',
    });
  }

  function addUrlsFromText(text) {
    const urls = extractUrls(text);
    const res = addToStaging(urls.map(url => ({ url })));
    reportAddResult(res, 'URL');
    return res;
  }

  function submitOmni() {
    const value = omniInput.value.trim();
    if (!value) {
      omniInput.focus();
      return;
    }
    if (omniMode() === 'url') {
      addUrlsFromText(value);
      omniInput.value = '';
      updateOmniMode();
    } else {
      performSearch(value);
    }
  }

  omniInput.addEventListener('input', updateOmniMode);
  omniInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      submitOmni();
    } else if (e.key === 'Escape') {
      stopPreview();
      if (!ytmResultsPanel.classList.contains('hidden')) {
        ytmResultsPanel.classList.add('hidden');
      } else if (omniInput.value) {
        omniInput.value = '';
        updateOmniMode();
      }
    }
  });

  // Pasting text containing URLs (single or multi-line) goes straight to the staging list.
  omniInput.addEventListener('paste', (e) => {
    const text = e.clipboardData ? e.clipboardData.getData('text') : '';
    if (extractUrls(text).length === 0) return;
    e.preventDefault();
    addUrlsFromText(text);
    updateOmniMode();
  });

  btnOmniClear.addEventListener('click', () => {
    omniInput.value = '';
    updateOmniMode();
    ytmResultsPanel.classList.add('hidden');
    omniInput.focus();
  });

  btnOmniSubmit.addEventListener('click', submitOmni);

  searchTypeChips.querySelectorAll('.ing-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      searchTypeChips.querySelectorAll('.ing-chip').forEach(c => {
        c.classList.toggle('active', c === chip);
        c.setAttribute('aria-checked', c === chip ? 'true' : 'false');
      });
      currentSearchType = chip.dataset.type || 'songs';
      const q = omniInput.value.trim();
      if (q && omniMode() === 'search' && !ytmResultsPanel.classList.contains('hidden')) {
        performSearch(q);
      }
    });
  });

  /* ---------------- Input Mode Switcher (Search vs Manual URL) ---------------- */
  function switchInputMode(mode) {
    const isSearch = mode === 'search';
    if (tabModeSearch) {
      tabModeSearch.classList.toggle('active', isSearch);
      tabModeSearch.setAttribute('aria-selected', isSearch ? 'true' : 'false');
    }
    if (tabModeManual) {
      tabModeManual.classList.toggle('active', !isSearch);
      tabModeManual.setAttribute('aria-selected', !isSearch ? 'true' : 'false');
    }
    if (searchModeContainer) searchModeContainer.classList.toggle('hidden', !isSearch);
    if (manualModeContainer) manualModeContainer.classList.toggle('hidden', isSearch);

    if (isSearch) {
      if (omniInput) omniInput.focus();
    } else {
      if (manualUrlInput) manualUrlInput.focus();
    }
  }

  if (tabModeSearch) tabModeSearch.addEventListener('click', () => switchInputMode('search'));
  if (tabModeManual) tabModeManual.addEventListener('click', () => switchInputMode('manual'));

  function submitManualUrls() {
    if (!manualUrlInput) return;
    const text = manualUrlInput.value.trim();
    if (!text) {
      manualUrlInput.focus();
      return;
    }
    const res = addUrlsFromText(text);
    if (res.added > 0) {
      manualUrlInput.value = '';
      if (manualCountHint) manualCountHint.textContent = 'Video tunggal atau playlist utuh didukung';
    }
  }

  if (manualUrlInput) {
    manualUrlInput.addEventListener('input', () => {
      const urls = extractUrls(manualUrlInput.value);
      if (manualCountHint) {
        manualCountHint.textContent = urls.length > 0
          ? `${urls.length} link URL terdeteksi`
          : 'Video tunggal atau playlist utuh didukung';
      }
    });

    manualUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submitManualUrls();
      }
    });
  }

  if (btnClearManualUrls && manualUrlInput) {
    btnClearManualUrls.addEventListener('click', () => {
      manualUrlInput.value = '';
      if (manualCountHint) manualCountHint.textContent = 'Video tunggal atau playlist utuh didukung';
      manualUrlInput.focus();
    });
  }

  if (btnAddManualUrls) {
    btnAddManualUrls.addEventListener('click', submitManualUrls);
  }

  /* ---------------- Search ---------------- */
  function setSearching(on) {
    omniSpinner.classList.toggle('hidden', !on);
    btnOmniSubmit.disabled = on;
    if (on) omniSubmitText.textContent = 'Mencari…';
    else updateOmniMode();
  }

  function showResultsMessage(text, isError = false) {
    ytmResultsList.replaceChildren();
    const box = el('div', 'ing-results-empty' + (isError ? ' is-error' : ''));
    box.appendChild(el('span', '', text));
    ytmResultsList.appendChild(box);
  }

  function showResultsSkeleton() {
    ytmResultsList.replaceChildren();
    for (let i = 0; i < 4; i++) {
      const row = el('div', 'ing-result is-skeleton');
      row.appendChild(el('div', 'ing-thumb'));
      const info = el('div', 'ing-result-info');
      info.appendChild(el('div', 'ing-skel-line'));
      info.appendChild(el('div', 'ing-skel-line short'));
      row.appendChild(info);
      ytmResultsList.appendChild(row);
    }
  }

  let currentSearchQuery = '';
  let currentSearchLimit = 15;
  let isLoadingMore = false;

  function parseDurationSec(durStr) {
    if (!durStr || typeof durStr !== 'string') return 0;
    const parts = durStr.trim().split(':').map(Number);
    if (parts.some(isNaN)) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0];
    return 0;
  }

  function getSortedResults() {
    const mode = resultsSortSelect ? resultsSortSelect.value : 'relevance';
    const sorted = currentResults.slice();
    if (mode === 'duration_desc') {
      sorted.sort((a, b) => parseDurationSec(b.duration) - parseDurationSec(a.duration));
    } else if (mode === 'duration_asc') {
      sorted.sort((a, b) => parseDurationSec(a.duration) - parseDurationSec(b.duration));
    } else if (mode === 'title_asc') {
      sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else {
      sorted.sort((a, b) => (a._originalIdx ?? 0) - (b._originalIdx ?? 0));
    }
    return sorted;
  }

  async function performSearch(query, limit = 15, isLoadMore = false) {
    if (!isLoadMore) {
      currentSearchQuery = query;
      currentSearchLimit = limit;
      setSearching(true);
      ytmResultsPanel.classList.remove('hidden');
      resultsTitle.textContent = `Mencari "${query}"…`;
      btnAddAllResults.classList.add('hidden');
      if (resultsFoot) resultsFoot.classList.add('hidden');
      showResultsSkeleton();
    } else {
      isLoadingMore = true;
      if (btnLoadMoreResults) btnLoadMoreResults.disabled = true;
      if (loadMoreSpinner) loadMoreSpinner.classList.remove('hidden');
      if (loadMoreText) loadMoreText.textContent = 'Memuat…';
    }

    const { ok, data, error } = await apiPost('/api/search', {
      query,
      type: currentSearchType,
      limit: currentSearchLimit,
      use_cookies: optUseCookies.checked,
    });

    if (!isLoadMore) {
      setSearching(false);
    } else {
      isLoadingMore = false;
      if (btnLoadMoreResults) btnLoadMoreResults.disabled = false;
      if (loadMoreSpinner) loadMoreSpinner.classList.add('hidden');
      if (loadMoreText) loadMoreText.textContent = 'Muat 15 Lagi...';
    }

    if (ok && data) {
      const rawList = data.results || [];
      currentResults = rawList.map((item, idx) => {
        const clean = sanitizeItem(item);
        if (clean) clean._originalIdx = idx;
        return clean;
      }).filter(Boolean);

      renderResults(query);

      if (resultsFoot) {
        const canLoadMore = currentResults.length >= currentSearchLimit && currentSearchLimit < 45;
        resultsFoot.classList.toggle('hidden', !canLoadMore);
      }
    } else {
      if (!isLoadMore) {
        const errMsg = error || 'Gagal memuat hasil pencarian.';
        resultsTitle.textContent = 'Pencarian gagal';
        showResultsMessage(errMsg, true);
        notify({ type: 'error', title: 'Pencarian Gagal', message: errMsg });
      } else {
        notify({ type: 'warning', title: 'Gagal Memuat Tambahan', message: error || 'Tidak dapat memuat hasil lebih banyak.' });
      }
    }
  }

  /* ---------------- Native Audio Preview Player ---------------- */
  let currentPreviewItem = null;

  function togglePreview(item) {
    if (!item || item.kind === 'playlist' || item.kind === 'album') return;
    if (currentPreviewItem && currentPreviewItem.url === item.url) {
      if (ingPreviewAudio && !ingPreviewAudio.paused) {
        ingPreviewAudio.pause();
        syncResultButtons();
        return;
      } else if (ingPreviewAudio && ingPreviewAudio.paused && ingPreviewAudio.src) {
        ingPreviewAudio.play().catch(() => {});
        syncResultButtons();
        return;
      }
    }
    startPreview(item);
  }

  function startPreview(item) {
    if (!item || !ingPreviewDock || !ingPreviewAudio) return;
    if (item.kind === 'playlist' || item.kind === 'album') return;
    currentPreviewItem = item;

    if (ingPreviewTitle) {
      ingPreviewTitle.textContent = item.title || 'Pratinjau Lagu';
      ingPreviewTitle.title = item.title || '';
    }
    if (ingPreviewArtist) {
      ingPreviewArtist.textContent = formatItemSubtitle(item) || item.artist || '';
    }
    if (ingPreviewThumb) {
      ingPreviewThumb.src = item.thumbnail || '';
      ingPreviewThumb.alt = item.title || '';
    }
    if (btnPreviewExternal) {
      btnPreviewExternal.href = item.url || '#';
    }
    if (ingPreviewBadgeText) {
      ingPreviewBadgeText.textContent = item.kind === 'video' ? 'Pratinjau Video Audio' : 'Pratinjau Audio (Native Opus)';
    }

    if (ingPreviewSpinner) ingPreviewSpinner.classList.remove('hidden');

    if (ingPreviewAudio.src) {
      ingPreviewAudio.pause();
    }
    const streamApiUrl = `/api/stream-preview?url=${encodeURIComponent(item.url)}`;
    ingPreviewAudio.src = streamApiUrl;
    ingPreviewAudio.load();
    const playPromise = ingPreviewAudio.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {});
    }

    ingPreviewDock.classList.remove('hidden');
    syncResultButtons();
  }

  function stopPreview() {
    currentPreviewItem = null;
    if (ingPreviewAudio) {
      ingPreviewAudio.pause();
      ingPreviewAudio.removeAttribute('src');
      ingPreviewAudio.load();
    }
    if (ingPreviewDock) ingPreviewDock.classList.add('hidden');
    syncResultButtons();
  }

  if (ingPreviewAudio) {
    ingPreviewAudio.addEventListener('playing', () => {
      if (ingPreviewSpinner) ingPreviewSpinner.classList.add('hidden');
      syncResultButtons();
    });
    ingPreviewAudio.addEventListener('pause', () => {
      syncResultButtons();
    });
    ingPreviewAudio.addEventListener('waiting', () => {
      if (ingPreviewSpinner) ingPreviewSpinner.classList.remove('hidden');
    });
    ingPreviewAudio.addEventListener('canplay', () => {
      if (ingPreviewSpinner) ingPreviewSpinner.classList.add('hidden');
    });
    ingPreviewAudio.addEventListener('error', () => {
      if (ingPreviewSpinner) ingPreviewSpinner.classList.add('hidden');
      if (currentPreviewItem && ingPreviewAudio.getAttribute('src')) {
        console.warn('[Audio Preview Error]', ingPreviewAudio.error);
        notify({
          type: 'error',
          title: 'Gagal Memuat Audio',
          message: 'Tidak dapat memutar pratinjau audio untuk lagu ini.',
        });
      }
    });
  }

  function renderResults(query) {
    resultsTitle.textContent = `${currentResults.length} hasil untuk "${query}"`;
    btnAddAllResults.classList.toggle('hidden', currentResults.length === 0);

    if (currentResults.length === 0) {
      showResultsMessage(`Tidak ditemukan hasil untuk "${query}". Coba kata kunci lain atau pilih "Semua".`);
      if (resultsFoot) resultsFoot.classList.add('hidden');
      return;
    }

    const displayItems = getSortedResults();
    ytmResultsList.replaceChildren();

    displayItems.forEach(item => {
      const isCollection = item.kind === 'playlist' || item.kind === 'album';
      const row = el('div', 'ing-result');
      row.setAttribute('role', 'listitem');
      row.dataset.url = item.url;
      if (isCollection) row.classList.add('is-collection');

      const thumbClass = 'ing-thumb' + (!isCollection ? ' can-preview' : '');
      const thumb = createThumb(item.thumbnail, thumbClass, isCollection ? '≡' : '♪');
      if (!isCollection) {
        thumb.title = `Pratinjau: ${item.title || item.url}`;
        thumb.addEventListener('click', (ev) => {
          ev.stopPropagation();
          togglePreview(item);
        });
      } else {
        thumb.title = item.title || item.url;
      }
      row.appendChild(thumb);

      const info = el('div', 'ing-result-info');
      const titleRow = el('div', 'ing-result-title-row');
      titleRow.appendChild(el('span', 'ing-result-title', item.title || item.url));

      // Quality & Source Tier Badges
      if (item.kind === 'song') {
        const isHq = item.audio_tier === 'hq' || Boolean(item.album) || !item.kind.includes('video');
        if (isHq) {
          const badge = el('span', 'ing-kind hq-master', '✨ HQ Audio');
          badge.title = 'Katalog Master Studio Resmi (Native Opus 48kHz / AAC)';
          titleRow.appendChild(badge);
        } else {
          const badge = el('span', 'ing-kind song', 'Lagu');
          badge.title = 'Trek Audio YouTube Music';
          titleRow.appendChild(badge);
        }
      } else if (item.kind === 'video') {
        const badge = el('span', 'ing-kind video', '🎬 Video Audio');
        badge.title = 'Audio dari Video Klip / Live Performance';
        titleRow.appendChild(badge);
      } else if (item.kind === 'playlist') {
        const extra = item.track_count ? ` • ${item.track_count}` : '';
        const badge = el('span', 'ing-kind playlist', `≡ Playlist${extra}`);
        badge.title = 'Daftar Putar';
        titleRow.appendChild(badge);
      } else if (item.kind === 'album') {
        const extra = item.track_count ? ` • ${item.track_count}` : '';
        const badge = el('span', 'ing-kind album', `💿 Album${extra}`);
        badge.title = 'Album Rilisan Resmi';
        titleRow.appendChild(badge);
      }
      info.appendChild(titleRow);

      const sub = formatItemSubtitle(item);
      const metaRow = el('div', 'ing-result-meta');
      if (sub) metaRow.appendChild(el('span', 'ing-result-sub', sub));
      if (item.duration) metaRow.appendChild(el('span', 'ing-result-dur mono-stat', item.duration));

      // Stream spec pill in meta row
      if (item.kind === 'song') {
        metaRow.appendChild(el('span', 'ing-result-spec mono-stat', 'Opus 48kHz • 160k'));
      } else if (item.kind === 'video') {
        metaRow.appendChild(el('span', 'ing-result-spec video mono-stat', 'Video Audio'));
      }
      info.appendChild(metaRow);
      row.appendChild(info);

      const actions = el('div', 'ing-result-actions');

      if (!isCollection) {
        const btnPreview = el('button', 'ing-icon-btn ing-result-preview', '▶');
        btnPreview.type = 'button';
        btnPreview.title = 'Pratinjau lagu ini (Play/Stop)';
        btnPreview.setAttribute('aria-label', `Pratinjau ${item.title}`);
        btnPreview.addEventListener('click', (ev) => {
          ev.stopPropagation();
          togglePreview(item);
        });
        actions.appendChild(btnPreview);
      }

      const btnNow = el('button', 'ing-icon-btn ing-result-now', '⚡');
      btnNow.type = 'button';
      btnNow.title = 'Unduh sekarang (langsung ke antrean, lewati daftar)';
      btnNow.setAttribute('aria-label', `Unduh sekarang: ${item.title}`);
      btnNow.addEventListener('click', (ev) => {
        ev.stopPropagation();
        rememberMeta(item);
        dispatchDownload([item.url], { fromStaging: false });
      });
      actions.appendChild(btnNow);

      const btnToggle = el('button', 'ing-result-add');
      btnToggle.type = 'button';
      btnToggle.addEventListener('click', (ev) => {
        ev.stopPropagation();
        toggleResult(item);
      });
      actions.appendChild(btnToggle);
      row.appendChild(actions);

      row.addEventListener('click', () => toggleResult(item));
      ytmResultsList.appendChild(row);
    });
    syncResultButtons();
  }

  function toggleResult(item) {
    if (isStaged(item.url)) removeFromStaging(item.url);
    else addToStaging([item]);
  }

  function syncResultButtons() {
    ytmResultsList.querySelectorAll('.ing-result[data-url]').forEach(row => {
      const url = row.dataset.url;
      const staged = isStaged(url);
      const isPreviewing = currentPreviewItem && currentPreviewItem.url === url;
      const isPlaying = isPreviewing && ingPreviewAudio && !ingPreviewAudio.paused;

      row.classList.toggle('is-staged', staged);
      row.classList.toggle('is-previewing', Boolean(isPreviewing));

      const btn = row.querySelector('.ing-result-add');
      if (btn) {
        btn.textContent = staged ? '✓ Di daftar' : '+ Tambah';
        btn.setAttribute('aria-pressed', staged ? 'true' : 'false');
      }

      const btnPrev = row.querySelector('.ing-result-preview');
      if (btnPrev) {
        btnPrev.textContent = isPlaying ? '⏸' : '▶';
        btnPrev.title = isPlaying ? 'Jeda pratinjau' : 'Pratinjau lagu ini';
      }
    });

    if (btnPreviewStage && currentPreviewItem) {
      const isCurStaged = isStaged(currentPreviewItem.url);
      btnPreviewStage.textContent = isCurStaged ? '✓ Di antrean' : '+ Antrean';
      btnPreviewStage.classList.toggle('is-staged', isCurStaged);
    }
  }

  if (resultsSortSelect) {
    resultsSortSelect.addEventListener('change', () => {
      renderResults(currentSearchQuery || omniInput.value.trim());
    });
  }

  if (btnLoadMoreResults) {
    btnLoadMoreResults.addEventListener('click', () => {
      if (isLoadingMore) return;
      currentSearchLimit = Math.min(currentSearchLimit + 15, 45);
      performSearch(currentSearchQuery, currentSearchLimit, true);
    });
  }

  if (btnClosePreview) {
    btnClosePreview.addEventListener('click', stopPreview);
  }

  if (btnPreviewStage) {
    btnPreviewStage.addEventListener('click', () => {
      if (!currentPreviewItem) return;
      toggleResult(currentPreviewItem);
      syncResultButtons();
    });
  }

  if (btnPreviewDownloadNow) {
    btnPreviewDownloadNow.addEventListener('click', () => {
      if (!currentPreviewItem) return;
      rememberMeta(currentPreviewItem);
      dispatchDownload([currentPreviewItem.url], { fromStaging: false });
    });
  }

  btnAddAllResults.addEventListener('click', () => {
    const res = addToStaging(currentResults);
    reportAddResult(res, 'item');
  });

  btnCloseResults.addEventListener('click', () => {
    ytmResultsPanel.classList.add('hidden');
    stopPreview();
    omniInput.focus();
  });

  /* ---------------- Settings (persisted) ---------------- */
  function selectedFormat() {
    return document.querySelector('input[name="audioFormat"]:checked')?.value || 'opus';
  }

  function setSwitchEnabled(wrap, input, enabled, disabledHint) {
    input.disabled = !enabled;
    wrap.classList.toggle('is-disabled', !enabled);
    const hint = wrap.querySelector('.ing-switch-hint');
    if (hint) hint.textContent = enabled ? hint.dataset.defaultHint : disabledHint;
  }

  function effectiveFormat() {
    const fmt = selectedFormat();
    return fmt === 'opus' && optRawWebm.checked ? 'native' : fmt;
  }

  function formatShortLabel() {
    const fmt = effectiveFormat();
    if (fmt === 'native') return 'Stream asli';
    if (fmt === 'mp3_320k') return 'MP3 320';
    if (fmt === 'mp3_vbr0') return 'MP3 V0';
    return 'Opus 48 kHz';
  }

  function updateSettingsUI() {
    const fmt = selectedFormat();
    const isOpus = fmt === 'opus';
    setSwitchEnabled(rawWebmToggleWrap, optRawWebm, isOpus, 'Hanya untuk format Opus');
    setSwitchEnabled(keepOpusToggleWrap, optKeepOpus, !isOpus, 'Hanya untuk format MP3');

    const keep = !isOpus && optKeepOpus.checked;
    let text;
    let color;
    if (isOpus && optRawWebm.checked) {
      text = 'Stream asli YouTube (.webm / .m4a) · tanpa remux';
      color = 'var(--accent-cyan)';
    } else if (isOpus) {
      text = 'Opus 48 kHz (.opus) · lossless remux · cover art HD · tag asli';
      color = 'var(--accent-emerald)';
    } else if (fmt === 'mp3_320k') {
      text = 'MP3 320 kbps CBR · konversi lossy' + (keep ? ' · + master Opus' : '');
      color = 'var(--accent-amber)';
    } else {
      text = 'MP3 VBR V0 · konversi lossy' + (keep ? ' · + master Opus' : '');
      color = 'var(--accent-purple)';
    }
    specText.textContent = text;
    specDot.style.backgroundColor = color;

    const active = [];
    if (isOpus && optRawWebm.checked) active.push('Stream mentah');
    if (keep) active.push('Master Opus');
    if (optPlaylist.checked) active.push('Subfolder');
    if (optAutoScan.checked) active.push('Auto QC');
    if (optUseCookies.checked) active.push('Cookies');
    advancedSummary.textContent = active.length ? active.join(' · ') : 'Semua nonaktif';

    persistSettings();
    updateActionBar();
  }

  function persistSettings() {
    writeJson(SETTINGS_KEY, {
      format: selectedFormat(),
      rawWebm: optRawWebm.checked,
      keepOpus: optKeepOpus.checked,
      playlist: optPlaylist.checked,
      autoScan: optAutoScan.checked,
      cookies: optUseCookies.checked,
      advOpen: advancedPanel.open,
    });
  }

  function restoreSettings() {
    const s = readJson(SETTINGS_KEY, null);
    if (!s || typeof s !== 'object') return;
    if (['opus', 'mp3_320k', 'mp3_vbr0'].includes(s.format)) {
      formatRadios.forEach(r => { r.checked = r.value === s.format; });
    }
    if (typeof s.rawWebm === 'boolean') optRawWebm.checked = s.rawWebm;
    if (typeof s.keepOpus === 'boolean') optKeepOpus.checked = s.keepOpus;
    if (typeof s.playlist === 'boolean') optPlaylist.checked = s.playlist;
    if (typeof s.autoScan === 'boolean') optAutoScan.checked = s.autoScan;
    if (typeof s.cookies === 'boolean') optUseCookies.checked = s.cookies;
    if (typeof s.advOpen === 'boolean') advancedPanel.open = s.advOpen;
  }

  formatRadios.forEach(r => r.addEventListener('change', updateSettingsUI));
  [optRawWebm, optKeepOpus, optPlaylist, optAutoScan, optUseCookies].forEach(cb => {
    cb.addEventListener('change', updateSettingsUI);
  });
  advancedPanel.addEventListener('toggle', persistSettings);

  /* ---------------- Action bar & dispatch ---------------- */
  function updateActionBar() {
    const n = staging.length;
    btnStartIngest.disabled = n === 0 || isSubmitting;
    btnStartIngest.classList.toggle('running', isSubmitting);
    if (isSubmitting) {
      btnStartText.textContent = 'Mengirim…';
    } else {
      btnStartText.textContent = n > 0 ? `Unduh ${n} item` : 'Mulai Unduh';
    }
    actionSummaryMain.textContent = n > 0 ? `${n} item siap diunduh` : 'Daftar masih kosong';
    const extras = [formatShortLabel()];
    if (optAutoScan.checked) extras.push('Auto QC');
    if (optPlaylist.checked) extras.push('Subfolder playlist');
    actionSummarySub.textContent = extras.join(' · ');
  }

  async function dispatchDownload(urls, { fromStaging }) {
    if (!urls.length || isSubmitting) return;
    isSubmitting = true;
    updateActionBar();

    const fmt = effectiveFormat();
    const keepOpus = fmt.startsWith('mp3') && optKeepOpus.checked;
    log('info', `[DISPATCH] Mengirim ${urls.length} item ke antrian unduhan (${fmt}${keepOpus ? ' + Opus (.webm)' : ''})...`);

    const { ok, data, error } = await apiPost('/api/download', {
      urls,
      auto_scan: optAutoScan.checked,
      is_playlist: optPlaylist.checked,
      audio_format: fmt,
      keep_opus: keepOpus,
      use_cookies: optUseCookies.checked,
      cookie_browser: 'chrome',
    });

    isSubmitting = false;

    if (ok) {
      log('info', '[DISPATCH] ' + data.message);
      const hasSkipped = (data.duplicate_count || 0) > 0 || (data.invalid_count || 0) > 0;
      notify({
        type: hasSkipped ? 'warning' : 'info',
        title: hasSkipped ? 'Antrian Ditambahkan (Dengan Catatan)' : 'Masuk Antrian Unduhan',
        message: data.message,
      });
      if (fromStaging) {
        const sent = new Set(urls);
        staging = staging.filter(s => !sent.has(s.url));
        saveStaging();
        renderStaging();
        syncResultButtons();
      }
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
    }
    updateActionBar();
  }

  btnStartIngest.addEventListener('click', () => {
    dispatchDownload(staging.map(s => s.url), { fromStaging: true });
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.page !== 'ingest') return;
    if (e.key === 'Escape') {
      if (ingPreviewDock && !ingPreviewDock.classList.contains('hidden')) {
        stopPreview();
        return;
      }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && staging.length > 0) {
      e.preventDefault();
      btnStartIngest.click();
    }
  });

  /* ---------------- Inbox summary ---------------- */
  async function refreshInboxSummary() {
    const { ok, data } = await apiGet('/api/library');
    if (!ok || !data) return;
    currentInboxDir = data.source_dir || '';
    const files = data.files || [];
    const playlists = (data.playlists || []).filter(p => p.name !== '__ROOT__');
    if (inboxTotalSongsPill) inboxTotalSongsPill.textContent = `${files.length} Lagu di Inbox`;
    if (inboxTotalPlaylistsPill) inboxTotalPlaylistsPill.textContent = `${playlists.length} Folder Playlist`;
  }

  if (btnOpenInboxExplorer) {
    btnOpenInboxExplorer.addEventListener('click', () => openFolderInExplorer('', currentInboxDir));
  }

  /* ---------------- Queue monitor rendering ---------------- */
  const TYPE_LABEL = { download: 'Unduh', resample: 'Konversi', split: 'Split' };

  function taskDisplay(task) {
    const meta = task.type === 'download' || !task.type ? metaFor(task.url) : null;
    const desc = task.type === 'download' || !task.type ? describeUrl(task.url || '') : null;
    return {
      title: (meta && meta.title) || task.title || (desc ? desc.label : task.url) || 'Tugas',
      sub: (meta && meta.artist) || '',
      thumbnail: meta ? meta.thumbnail : '',
      typeLabel: TYPE_LABEL[task.type] || 'Tugas',
    };
  }

  function outcomeOf(task) {
    const out = task.outcome || task.status;
    if (out === 'ALREADY_EXISTS') return { cls: 'exists', icon: '≡', label: 'Sudah ada' };
    if (out === 'FAILED' || task.status === 'FAILED') return { cls: 'error', icon: '✕', label: 'Gagal' };
    if (out === 'WARNING' || out === 'PARTIAL') return { cls: 'warning', icon: '!', label: 'Selesai (catatan)' };
    return { cls: 'success', icon: '✓', label: 'Selesai' };
  }

  function renderActive(current, lastFinished) {
    activeJobArt.replaceChildren();
    if (current) {
      const d = taskDisplay(current);
      const p = Math.max(0, Math.min(100, Math.round(current.progress || 0)));
      activeJobBox.dataset.state = 'active';
      const art = createThumb(d.thumbnail, 'ing-now-art-inner');
      activeJobArt.appendChild(art);
      jobStatusTag.textContent = current.status || 'PROCESSING';
      jobStatusTag.className = 'ing-status active';
      activeJobTitle.textContent = d.title;
      jobUrlLabel.textContent = [d.typeLabel, d.sub, current.url].filter(Boolean).join(' · ');
      jobUrlLabel.title = current.url || '';
      progressFill.style.width = p + '%';
      progressText.textContent = p + '%';
      progressBar.setAttribute('aria-valuenow', String(p));
      return;
    }
    progressBar.removeAttribute('aria-valuenow');
    if (lastFinished) {
      const d = taskDisplay(lastFinished);
      const o = outcomeOf(lastFinished);
      activeJobBox.dataset.state = o.cls;
      activeJobArt.appendChild(createThumb(d.thumbnail, 'ing-now-art-inner', o.icon));
      jobStatusTag.textContent = o.label.toUpperCase();
      jobStatusTag.className = 'ing-status ' + o.cls;
      activeJobTitle.textContent = d.title;
      jobUrlLabel.textContent = lastFinished.summary || lastFinished.error || 'Tugas selesai diproses.';
      jobUrlLabel.title = jobUrlLabel.textContent;
      progressFill.style.width = '100%';
      progressText.textContent = formatAgo(lastFinished.finished_at);
    } else {
      activeJobBox.dataset.state = 'idle';
      activeJobArt.textContent = '♪';
      jobStatusTag.textContent = 'IDLE';
      jobStatusTag.className = 'ing-status';
      activeJobTitle.textContent = 'Tidak ada unduhan aktif';
      jobUrlLabel.textContent = 'Tambahkan lagu di panel kiri untuk memulai.';
      jobUrlLabel.title = '';
      progressFill.style.width = '0%';
      progressText.textContent = '';
    }
  }

  function renderWaiting(queue) {
    waitingList.replaceChildren();
    waitingEmpty.classList.toggle('hidden', queue.length > 0);
    queue.forEach((task, idx) => {
      const d = taskDisplay(task);
      const li = el('li', 'ing-qitem');
      li.appendChild(el('span', 'ing-qitem-idx mono-stat', String(idx + 1)));
      li.appendChild(createThumb(d.thumbnail, 'ing-thumb sm'));
      const info = el('div', 'ing-qitem-info');
      info.appendChild(el('div', 'ing-qitem-title', d.title));
      const sub = [d.typeLabel, task.audio_format ? String(task.audio_format).replace('_', ' ').toUpperCase() : '', d.sub]
        .filter(Boolean).join(' · ');
      info.appendChild(el('div', 'ing-qitem-sub', sub));
      info.title = task.url || '';
      li.appendChild(info);
      waitingList.appendChild(li);
    });
  }

  function renderHistory(history) {
    historyList.replaceChildren();
    historyEmpty.classList.toggle('hidden', history.length > 0);
    history.forEach(task => {
      const d = taskDisplay(task);
      const o = outcomeOf(task);
      const li = el('li', `ing-qitem is-${o.cls}`);
      li.appendChild(el('span', `ing-outcome ${o.cls}`, o.icon));
      const info = el('div', 'ing-qitem-info');
      info.appendChild(el('div', 'ing-qitem-title', d.title));
      info.appendChild(el('div', 'ing-qitem-sub', task.summary || task.error || o.label));
      info.title = [task.summary, task.error, task.url].filter(Boolean).join('\n');
      li.appendChild(info);
      li.appendChild(el('span', 'ing-qitem-time', formatAgo(task.finished_at)));
      historyList.appendChild(li);
    });
  }

  function renderSnapshot(data) {
    const queue = Array.isArray(data.queue) ? data.queue : [];
    const history = Array.isArray(data.history) ? data.history : [];
    const current = data.current || null;

    queueCounter.textContent = String(queue.length);
    statActive.textContent = current ? '1' : '0';

    // Skip list re-render when nothing changed (avoids thumbnail flicker every poll).
    const sig = JSON.stringify([
      queue.map(t => t.id),
      history.map(t => [t.id, t.outcome]),
      Math.floor(Date.now() / 60000), // refresh relative times once per minute
    ]);
    if (sig !== lastMonitorSignature) {
      lastMonitorSignature = sig;
      renderWaiting(queue);
      renderHistory(history);
    }
    renderActive(current, history[0] || null);
  }

  const queueMonitor = createQueueMonitor({
    terminalLogs,
    onSnapshot: renderSnapshot,
    onTaskFinished: (task) => {
      if (Array.isArray(task.logs) && task.logs.length > 0) {
        renderLogs(terminalLogs, task.logs);
      }
      refreshInboxSummary();
    },
    onIdle: (justFinished) => {
      if (justFinished) refreshInboxSummary();
    },
  });

  /* ---------------- Log panel ---------------- */
  btnClearLogs.addEventListener('click', () => terminalLogs.replaceChildren());
  const btnLogFilterAll = $('btnLogFilterAll');
  const btnLogFilterErrors = $('btnLogFilterErrors');
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

  /* ---------------- Init ---------------- */
  restoreSettings();
  updateSettingsUI();
  renderStaging();
  updateOmniMode();

  queueMonitor.poll();
  refreshInboxSummary();
  setInterval(() => queueMonitor.poll(), 2000);
});
