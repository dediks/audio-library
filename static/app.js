/**
 * Audio Lab Ingestion & Soundsystem QC - Frontend Client Logic
 * Strict DOM Manipulation (No innerHTML, strictly textContent & createElement)
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Element References
  const form = document.getElementById('ingestForm');
  const urlInput = document.getElementById('urlInput');
  const optAutoScan = document.getElementById('optAutoScan');
  const optPlaylist = document.getElementById('optPlaylist');
  const optUseCookies = document.getElementById('optUseCookies');
  const btnStartIngest = document.getElementById('btnStartIngest');

  const ytdlpDot = document.getElementById('ytdlpDot');
  const ytdlpVal = document.getElementById('ytdlpVal');
  const ffmpegDot = document.getElementById('ffmpegDot');
  const ffmpegVal = document.getElementById('ffmpegVal');
  const pythonVal = document.getElementById('pythonVal');

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
  const btnAuditAll = document.getElementById('btnAuditAll');
  const libraryTableBody = document.getElementById('libraryTableBody');

  let pollingInterval = null;

  // 1. Check System Dependencies
  async function fetchSystemStatus() {
    try {
      const res = await fetch('/api/system');
      if (!res.ok) return;
      const data = await res.json();

      pythonVal.textContent = data.python || '3.12';

      if (data.yt_dlp) {
        ytdlpDot.className = 'status-indicator active';
        ytdlpVal.textContent = 'Installed';
      } else {
        ytdlpDot.className = 'status-indicator error';
        ytdlpVal.textContent = 'Missing';
      }

      if (data.ffmpeg) {
        ffmpegDot.className = 'status-indicator active';
        ffmpegVal.textContent = 'Installed';
      } else {
        ffmpegDot.className = 'status-indicator error';
        ffmpegVal.textContent = 'Missing';
      }

      // Show notice banner if missing
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
    } catch (err) {
      appendLog('error', '[SYSTEM] Gagal memverifikasi status backend: ' + err.message);
    }
  }

  // 2. Fetch Queue and Live Logs
  async function fetchQueueState() {
    try {
      const res = await fetch('/api/queue');
      if (!res.ok) return;
      const data = await res.json();

      const queueLen = (data.queue || []).length;
      queueCounter.textContent = 'Antrian: ' + queueLen;

      const current = data.current;
      if (current) {
        jobStatusTag.textContent = current.status || 'PROCESSING';
        jobStatusTag.className = 'job-status-tag active';
        jobUrlLabel.textContent = current.url;

        const p = Math.round(current.progress || 0);
        progressFill.style.width = p + '%';
        progressText.textContent = p + '% Complete';
        btnStartIngest.disabled = true;
        btnStartIngest.classList.add('running');

        // Update logs if available
        if (Array.isArray(current.logs) && current.logs.length > 0) {
          renderLogs(current.logs);
        }
      } else {
        jobStatusTag.textContent = 'IDLE';
        jobStatusTag.className = 'job-status-tag';
        if (queueLen === 0) {
          jobUrlLabel.textContent = 'Belum ada tugas unduhan aktif';
          progressFill.style.width = '0%';
          progressText.textContent = '0% Complete';
          btnStartIngest.disabled = false;
          btnStartIngest.classList.remove('running');
        }
      }
    } catch (err) {
      // Background poll failure
    }
  }

  // Helper: Append a single log safely
  function appendLog(level, message) {
    const p = document.createElement('p');
    p.className = 'log-line ' + level;
    p.textContent = message;
    terminalLogs.appendChild(p);
    terminalLogs.scrollTop = terminalLogs.scrollHeight;
  }

  // Helper: Render array of logs safely
  function renderLogs(logs) {
    terminalLogs.replaceChildren();
    logs.forEach(msg => {
      const p = document.createElement('p');
      let lvl = 'info';
      if (msg.includes('ERROR') || msg.includes('Failed')) lvl = 'error';
      else if (msg.includes('WARNING') || msg.includes('caution')) lvl = 'warn';
      p.className = 'log-line ' + lvl;
      p.textContent = msg;
      terminalLogs.appendChild(p);
    });
    terminalLogs.scrollTop = terminalLogs.scrollHeight;
  }

  // 3. Fetch Library Files and QC Data
  async function fetchLibraryFiles() {
    try {
      const res = await fetch('/api/library');
      if (!res.ok) return;
      const data = await res.json();
      const files = data.files || [];

      libraryTableBody.replaceChildren();

      if (files.length === 0) {
        const tr = document.createElement('tr');
        tr.className = 'empty-row';
        const td = document.createElement('td');
        td.setAttribute('colspan', '8');
        td.textContent = 'Belum ada file audio di library/inbox. Masukkan URL YouTube di atas untuk memulai.';
        tr.appendChild(td);
        libraryTableBody.appendChild(tr);
        return;
      }

      files.forEach(f => {
        const tr = document.createElement('tr');

        // File name with optional Playlist Folder tag
        const tdName = document.createElement('td');
        tdName.className = 'file-name-cell';

        const wrapper = document.createElement('div');
        wrapper.className = 'file-name-wrapper';

        if (f.folder) {
          const folderBadge = document.createElement('span');
          folderBadge.className = 'playlist-folder-badge';
          folderBadge.textContent = '📁 ' + f.folder;
          folderBadge.title = 'Playlist: ' + f.folder;
          wrapper.appendChild(folderBadge);
        }

        const titleSpan = document.createElement('span');
        titleSpan.className = 'file-title-text';
        titleSpan.textContent = f.name;
        titleSpan.title = f.name;
        wrapper.appendChild(titleSpan);

        tdName.appendChild(wrapper);
        tr.appendChild(tdName);

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

        libraryTableBody.appendChild(tr);
      });
    } catch (err) {
      appendLog('error', '[LIBRARY] Gagal memuat daftar file: ' + err.message);
    }
  }

  // Format radio change listeners
  const specText = document.getElementById('specText');
  const specDot = document.getElementById('specDot');
  const formatRadios = document.querySelectorAll('input[name="audioFormat"]');
  if (specDot) specDot.style.backgroundColor = '#10b981';

  formatRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      const val = radio.value;
      if (val === 'premium_aac') {
        if (specText) specText.textContent = 'Target: Premium AAC 256k (YouTube Music via Chrome - Smart Fallback)';
        if (specDot) specDot.style.backgroundColor = '#10b981';
      } else if (val === 'native') {
        if (specText) specText.textContent = 'Target: Native Stream Opus 48kHz (Bit-Preserved - Standar FOH)';
        if (specDot) specDot.style.backgroundColor = 'var(--accent-cyan)';
      } else if (val === 'mp3_320k') {
        if (specText) specText.textContent = 'Target: MP3 320 kbps CBR (Kualitas Tertinggi LAME)';
        if (specDot) specDot.style.backgroundColor = 'var(--accent-amber)';
      } else if (val === 'mp3_vbr0') {
        if (specText) specText.textContent = 'Target: MP3 VBR 0 (LAME Extreme Dynamic Bitrate)';
        if (specDot) specDot.style.backgroundColor = '#c084fc';
      }
    });
  });

  // 4. Submit Batch Ingestion Form
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawVal = urlInput.value.trim();
    if (!rawVal) return;

    const urls = rawVal.split('\n').map(l => l.trim()).filter(Boolean);
    const autoScan = optAutoScan ? optAutoScan.checked : true;
    const isPlaylist = optPlaylist ? optPlaylist.checked : false;
    const useCookies = optUseCookies ? optUseCookies.checked : true;
    const audioFormat = document.querySelector('input[name="audioFormat"]:checked')?.value || 'premium_aac';

    btnStartIngest.disabled = true;
    appendLog('info', `[DISPATCH] Mengirim ${urls.length} item ke antrian unduhan (${audioFormat})...`);

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls,
          auto_scan: autoScan,
          is_playlist: isPlaylist,
          audio_format: audioFormat,
          use_cookies: useCookies,
          cookie_browser: 'chrome'
        })
      });

      const data = await res.json();
      if (res.ok) {
        appendLog('info', '[DISPATCH] ' + data.message);
        urlInput.value = '';
        fetchQueueState();
      } else {
        appendLog('error', '[DISPATCH ERROR] ' + (data.error || 'Gagal menambahkan tugas.'));
        btnStartIngest.disabled = false;
      }
    } catch (err) {
      appendLog('error', '[NETWORK ERROR] ' + err.message);
      btnStartIngest.disabled = false;
    }
  });

  // 5. Actions: Refresh & Full Audit
  btnRefreshLibrary.addEventListener('click', () => {
    fetchLibraryFiles();
  });

  btnAuditAll.addEventListener('click', async () => {
    btnAuditAll.disabled = true;
    appendLog('info', '[AUDIT] Memulai audit audio QC menyeluruh (EBU R128 & True Peak)...');
    try {
      const res = await fetch('/api/scan', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        appendLog('info', `[AUDIT] Selesai. ${(data.results || []).length} file berhasil diukur.`);
        fetchLibraryFiles();
      } else {
        appendLog('error', '[AUDIT ERROR] ' + (data.error || 'Audit gagal.'));
      }
    } catch (err) {
      appendLog('error', '[AUDIT NETWORK ERROR] ' + err.message);
    } finally {
      btnAuditAll.disabled = false;
    }
  });

  btnClearLogs.addEventListener('click', () => {
    terminalLogs.replaceChildren();
  });

  // Start polling
  fetchSystemStatus();
  fetchQueueState();
  fetchLibraryFiles();

  pollingInterval = setInterval(() => {
    fetchQueueState();
    fetchLibraryFiles();
  }, 2000);
});
