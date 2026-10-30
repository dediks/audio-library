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

  queueMonitor.poll();
  refreshInboxSummary();
  setInterval(() => {
    queueMonitor.poll();
  }, 2000);
});
