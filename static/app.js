/**
 * Audio Lab Ingestion & Soundsystem QC - Frontend Client Logic
 * Strict DOM Manipulation (No innerHTML, strictly textContent & createElement)
 */

import {
  initAppHeader,
  appendLog,
  renderLogs,
  notify,
  groupFilesByFolder,
  createGroupHeaderBar,
  createFileNameCell,
  createQueueMonitor,
} from './modules/ui-shared.js';

document.addEventListener('DOMContentLoaded', () => {
  // DOM Element References
  const form = document.getElementById('ingestForm');
  const urlInput = document.getElementById('urlInput');
  const optAutoScan = document.getElementById('optAutoScan');
  const optPlaylist = document.getElementById('optPlaylist');
  const optUseCookies = document.getElementById('optUseCookies');
  const optKeepOpus = document.getElementById('optKeepOpus');
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
  const btnResampleMp3 = document.getElementById('btnResampleMp3');
  const btnAuditAll = document.getElementById('btnAuditAll');
  const libraryTableBody = document.getElementById('libraryTableBody');
  const librarySearchInput = document.getElementById('librarySearchInput');
  const librarySummaryPill = document.getElementById('librarySummaryPill');
  const btnCollapseAllGroups = document.getElementById('btnCollapseAllGroups');
  const btnExpandAllGroups = document.getElementById('btnExpandAllGroups');

  let allLibraryFiles = [];
  const collapsedGroups = new Set();
  // Map of groupKey -> { childRows: HTMLTableRowElement[], chevron: HTMLElement, toggleHint: HTMLElement }
  const groupDomMap = new Map();

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
    try {
      const res = await fetch('/api/library');
      if (!res.ok) return;
      const data = await res.json();
      allLibraryFiles = data.files || [];
      renderLibraryTable();
    } catch (err) {
      log('error', '[LIBRARY] Gagal memuat daftar file: ' + err.message);
    }
  }

  function setGroupCollapsed(groupKey, collapse) {
    if (collapse) collapsedGroups.add(groupKey);
    else collapsedGroups.delete(groupKey);

    const domEntry = groupDomMap.get(groupKey);
    if (!domEntry) return;
    domEntry.chevron.classList.toggle('collapsed', collapse);
    domEntry.toggleHint.textContent = collapse ? 'Buka Daftar' : 'Lipat';
    domEntry.childRows.forEach(tr => {
      tr.classList.toggle('group-row-hidden', collapse);
    });
  }

  function renderLibraryTable() {
    libraryTableBody.replaceChildren();
    groupDomMap.clear();

    const query = (librarySearchInput ? librarySearchInput.value : '').trim().toLowerCase();
    const filtered = query
      ? allLibraryFiles.filter(f =>
          f.name.toLowerCase().includes(query) ||
          (f.folder || '').toLowerCase().includes(query)
        )
      : allLibraryFiles;

    const groups = groupFilesByFolder(filtered);
    if (librarySummaryPill) {
      librarySummaryPill.textContent = `${filtered.length} lagu • ${groups.length} folder`;
    }

    if (filtered.length === 0) {
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      const td = document.createElement('td');
      td.setAttribute('colspan', '8');
      td.textContent = allLibraryFiles.length === 0
        ? 'Belum ada file audio di library/inbox. Masukkan URL YouTube di atas untuk memulai.'
        : 'Tidak ada lagu atau playlist yang cocok dengan kata kunci pencarian.';
      tr.appendChild(td);
      libraryTableBody.appendChild(tr);
      return;
    }

    const fragment = document.createDocumentFragment();

    groups.forEach(group => {
      const isCollapsed = collapsedGroups.has(group.key);

      // Group Header Row
      const headerTr = document.createElement('tr');
      headerTr.className = 'group-header-row';
      const headerTd = document.createElement('td');
      headerTd.setAttribute('colspan', '8');

      const { bar, chevron, toggleHint } = createGroupHeaderBar(group, isCollapsed);
      headerTd.appendChild(bar);
      headerTr.appendChild(headerTd);

      headerTr.addEventListener('click', () => {
        const nextCollapsed = !collapsedGroups.has(group.key);
        setGroupCollapsed(group.key, nextCollapsed);
      });

      fragment.appendChild(headerTr);

      const childRows = [];
      group.files.forEach((f, idx) => {
        const tr = document.createElement('tr');
        if (isCollapsed) tr.classList.add('group-row-hidden');

        // Compact single-line song title with track index (folder is already shown on the group header)
        tr.appendChild(createFileNameCell(f, { index: idx + 1, showFolderBadge: false }));

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

      groupDomMap.set(group.key, { childRows, chevron, toggleHint });
    });

    libraryTableBody.appendChild(fragment);
  }

  if (librarySearchInput) {
    librarySearchInput.addEventListener('input', renderLibraryTable);
  }

  if (btnCollapseAllGroups) {
    btnCollapseAllGroups.addEventListener('click', () => {
      groupDomMap.forEach((_, key) => setGroupCollapsed(key, true));
    });
  }

  if (btnExpandAllGroups) {
    btnExpandAllGroups.addEventListener('click', () => {
      groupDomMap.forEach((_, key) => setGroupCollapsed(key, false));
    });
  }

  // Format radio change listeners
  const specText = document.getElementById('specText');
  const specDot = document.getElementById('specDot');
  const formatRadios = document.querySelectorAll('input[name="audioFormat"]');
  if (specDot) specDot.style.backgroundColor = '#10b981';

  function updateFormatSpecBanner() {
    const val = document.querySelector('input[name="audioFormat"]:checked')?.value || 'native';
    const keepOpus = optKeepOpus ? optKeepOpus.checked : false;
    const opusSuffix = keepOpus ? ' + Simpan File Asli Opus (.webm)' : '';
    if (val === 'native') {
      if (specText) specText.textContent = 'Target: Best Available - stream asli YouTube, tanpa konversi';
      if (specDot) specDot.style.backgroundColor = '#10b981';
    } else if (val === 'mp3_320k') {
      if (specText) specText.textContent = 'Target: MP3 320 kbps CBR' + opusSuffix + ' (KONVERSI lossy)';
      if (specDot) specDot.style.backgroundColor = 'var(--accent-amber)';
    } else if (val === 'mp3_vbr0') {
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
    const audioFormat = document.querySelector('input[name="audioFormat"]:checked')?.value || 'native';

    btnStartIngest.disabled = true;
    const opusLog = (audioFormat !== 'native' && keepOpus) ? ' + Opus (.webm)' : '';
    log('info', `[DISPATCH] Mengirim ${urls.length} item ke antrian unduhan (${audioFormat}${opusLog})...`);

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls,
          auto_scan: autoScan,
          is_playlist: isPlaylist,
          audio_format: audioFormat,
          keep_opus: keepOpus,
          use_cookies: useCookies,
          cookie_browser: 'chrome',
        }),
      });

      const data = await res.json();
      if (res.ok) {
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
        const errMsg = data.error || 'Gagal menambahkan tugas.';
        log('error', '[DISPATCH ERROR] ' + errMsg);
        notify({
          type: data.duplicate_count > 0 ? 'exists' : 'error',
          title: data.duplicate_count > 0 ? 'URL Sudah Dalam Antrian' : 'Gagal Menambahkan Unduhan',
          message: errMsg,
          playSound: true,
        });
        btnStartIngest.disabled = false;
      }
    } catch (err) {
      log('error', '[NETWORK ERROR] ' + err.message);
      notify({
        type: 'error',
        title: 'Kesalahan Jaringan',
        message: 'Tidak dapat menghubungi server lokal: ' + err.message,
        playSound: true,
      });
      btnStartIngest.disabled = false;
    }
  });

  // 5. Actions: Refresh, Resample & Full Audit
  async function triggerResample(relPath, onlyMp3) {
    try {
      const res = await fetch('/api/resample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rel_path: relPath || null,
          target_rate: 44100,
          only_mp3: Boolean(onlyMp3),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        log('info', '[RESAMPLE] ' + data.message);
        notify({
          type: 'info',
          title: 'Konversi Dijadwalkan',
          message: data.message,
        });
        queueMonitor.poll();
      } else {
        const errMsg = data.error || 'Gagal menjadwalkan konversi sample rate.';
        log('error', '[RESAMPLE ERROR] ' + errMsg);
        notify({
          type: 'error',
          title: 'Gagal Menjadwalkan Konversi',
          message: errMsg,
          playSound: true,
        });
      }
    } catch (err) {
      log('error', '[RESAMPLE NETWORK ERROR] ' + err.message);
      notify({
        type: 'error',
        title: 'Kesalahan Jaringan',
        message: err.message,
        playSound: true,
      });
    }
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
      const res = await fetch('/api/scan', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
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
        const errMsg = data.error || 'Audit gagal.';
        log('error', '[AUDIT ERROR] ' + errMsg);
        notify({
          type: 'error',
          title: 'Audit QC Gagal',
          message: errMsg,
          playSound: true,
        });
      }
    } catch (err) {
      log('error', '[AUDIT NETWORK ERROR] ' + err.message);
      notify({
        type: 'error',
        title: 'Audit QC Gagal',
        message: err.message,
        playSound: true,
      });
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
