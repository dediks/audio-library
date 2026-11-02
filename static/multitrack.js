/**
 * Audio Lab - Stage 5: Multitrack WAV Auto-Splitter Client Logic
 * Strict DOM Manipulation (No innerHTML, strictly textContent & createElement)
 */

import {
  initAppHeader,
  apiPost,
  appendLog,
  notify,
  createQueueMonitor,
  openFolderInExplorer,
  getSharedWorkspaceState,
  saveSharedWorkspaceState,
} from './modules/ui-shared.js';
import { initFolderModal } from './modules/folder-modal.js';

function formatTimeMMSS(seconds) {
  const sec = Math.max(0, Number(seconds) || 0);
  const total = Math.round(sec);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const rem = total % 60;
  const pad2 = n => String(n).padStart(2, '0');
  if (hrs > 0) {
    return pad2(hrs) + ':' + pad2(mins) + ':' + pad2(rem);
  }
  return pad2(mins) + ':' + pad2(rem);
}

function formatTimeInput(seconds) {
  const sec = Math.max(0, Number(seconds) || 0);
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const rem = (sec - (hrs * 3600 + mins * 60)).toFixed(1);
  const pad2 = n => String(n).padStart(2, '0');
  const remStr = Number(rem) < 10 ? '0' + rem : String(rem);
  if (hrs > 0) {
    return pad2(hrs) + ':' + pad2(mins) + ':' + remStr;
  }
  return pad2(mins) + ':' + remStr;
}

function parseTimeInput(rawStr) {
  const s = String(rawStr || '').trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const val = parseFloat(s);
    return Number.isFinite(val) && val >= 0 ? val : null;
  }
  const parts = s.split(':');
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10);
    const sec = parseFloat(parts[1]);
    if (Number.isFinite(m) && m >= 0 && Number.isFinite(sec) && sec >= 0 && sec < 60) {
      return m * 60 + sec;
    }
  } else if (parts.length === 3) {
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const sec = parseFloat(parts[2]);
    if (
      Number.isFinite(h) &&
      h >= 0 &&
      Number.isFinite(m) &&
      m >= 0 &&
      m < 60 &&
      Number.isFinite(sec) &&
      sec >= 0 &&
      sec < 60
    ) {
      return h * 3600 + m * 60 + sec;
    }
  }
  return null;
}

document.addEventListener('DOMContentLoaded', () => {
  initAppHeader({ activePage: 'multitrack' });

  // DOM References
  const targetModeRadios = document.querySelectorAll('input[name="targetMode"]');
  const detectPresetRadios = document.querySelectorAll('input[name="detectPreset"]');
  const stemOrgRadios = document.querySelectorAll('input[name="stemOrgMode"]');
  const multichannelModeRadios = document.querySelectorAll('input[name="multichannelMode"]');

  const activeSourceBadge = document.getElementById('activeSourceBadge');
  const sourceDirInput = document.getElementById('sourceDirInput');
  const btnBrowseSource = document.getElementById('btnBrowseSource');
  const btnOpenSourceExplorer = document.getElementById('btnOpenSourceExplorer');
  const btnRefreshSource = document.getElementById('btnRefreshSource');
  const subfolderChipsRow = document.getElementById('subfolderChipsRow');

  const targetFileCol = document.getElementById('targetFileCol');
  const targetSelectLabel = document.getElementById('targetSelectLabel');
  const targetFileSelect = document.getElementById('targetFileSelect');
  const channelModeCol = document.getElementById('channelModeCol');
  const channelModeSelect = document.getElementById('channelModeSelect');
  const targetSelectorRow = document.getElementById('targetSelectorRow');

  const sumTypePill = document.getElementById('sumTypePill');
  const sumCountPill = document.getElementById('sumCountPill');
  const sumDurationPill = document.getElementById('sumDurationPill');
  const sumSpecPill = document.getElementById('sumSpecPill');

  const detectParamsGrid = document.getElementById('detectParamsGrid');
  const inputNoiseDb = document.getElementById('inputNoiseDb');
  const inputMinSilence = document.getElementById('inputMinSilence');
  const inputMinSong = document.getElementById('inputMinSong');
  const inputPadBefore = document.getElementById('inputPadBefore');
  const inputPadAfter = document.getElementById('inputPadAfter');
  const manualTimestampsBox = document.getElementById('manualTimestampsBox');
  const manualTimestampsInput = document.getElementById('manualTimestampsInput');

  const optsFolderStems = document.getElementById('optsFolderStems');
  const optsMultichannelWav = document.getElementById('optsMultichannelWav');

  const destDirInput = document.getElementById('destDirInput');
  const btnBrowseDest = document.getElementById('btnBrowseDest');
  const btnClearDest = document.getElementById('btnClearDest');

  const btnDetectSegments = document.getElementById('btnDetectSegments');
  const btnDetectSegmentsText = document.getElementById('btnDetectSegmentsText');
  const btnExecuteSplit = document.getElementById('btnExecuteSplit');
  const btnExecuteSplitText = document.getElementById('btnExecuteSplitText');
  const btnExecuteSplitBottom = document.getElementById('btnExecuteSplitBottom');
  const btnExecuteSplitBottomText = document.getElementById('btnExecuteSplitBottomText');

  const btnAddSegmentRow = document.getElementById('btnAddSegmentRow');
  const btnAutoNumberTitles = document.getElementById('btnAutoNumberTitles');
  const chkAllSegments = document.getElementById('chkAllSegments');
  const detectionResultSub = document.getElementById('detectionResultSub');
  const timelineTargetLabel = document.getElementById('timelineTargetLabel');
  const timelineTotalLabel = document.getElementById('timelineTotalLabel');
  const timelineSegmentsTrack = document.getElementById('timelineSegmentsTrack');
  const segmentsTableBody = document.getElementById('segmentsTableBody');

  const queueCounter = document.getElementById('queueCounter');
  const jobStatusTag = document.getElementById('jobStatusTag');
  const jobUrlLabel = document.getElementById('jobUrlLabel');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const terminalLogs = document.getElementById('terminalLogs');
  const btnClearLogs = document.getElementById('btnClearLogs');

  // State
  const sharedInit = getSharedWorkspaceState();
  let currentSourceDir = sharedInit.sourceDir || '';
  let defaultInboxDir = '';
  let dirInspectData = null;
  let currentTotalDuration = 0;
  let segmentsList = [];

  function log(level, message) {
    appendLog(terminalLogs, level, message);
  }

  if (btnClearLogs && terminalLogs) {
    btnClearLogs.addEventListener('click', () => {
      terminalLogs.replaceChildren();
      log('info', '[MULTITRACK] Log dibersihkan.');
    });
  }

  function getTargetMode() {
    const checked = document.querySelector('input[name="targetMode"]:checked');
    return checked ? checked.value : 'folder_stems';
  }

  function setTargetMode(mode) {
    targetModeRadios.forEach(r => {
      r.checked = r.value === mode;
    });
    syncModeUI();
  }

  function getDetectPreset() {
    const checked = document.querySelector('input[name="detectPreset"]:checked');
    return checked ? checked.value : 'adaptive';
  }

  function getRadioVal(radios, fallback) {
    for (const r of radios) {
      if (r.checked) return r.value;
    }
    return fallback;
  }

  function syncModeUI() {
    const mode = getTargetMode();
    if (optsFolderStems) optsFolderStems.classList.toggle('hidden', mode !== 'folder_stems');
    if (optsMultichannelWav) optsMultichannelWav.classList.toggle('hidden', mode !== 'multichannel_wav');

    const showCh = mode === 'multichannel_wav';
    if (channelModeCol) channelModeCol.classList.toggle('hidden', !showCh);
    if (targetSelectorRow) targetSelectorRow.classList.toggle('has-two-cols', showCh);

    if (targetSelectLabel) {
      if (mode === 'folder_stems') {
        targetSelectLabel.textContent = 'Track Referensi Deteksi Jeda Lagu (Stem):';
      } else {
        targetSelectLabel.textContent = 'Pilih File WAV Multichannel / Rekaman Panjang:';
      }
    }

    populateTargetDropdown();
    updateSummaryPills();
  }

  function syncPresetUI() {
    const preset = getDetectPreset();
    const isManual = preset === 'manual';
    if (manualTimestampsBox) manualTimestampsBox.classList.toggle('hidden', !isManual);
    if (detectParamsGrid) detectParamsGrid.classList.toggle('hidden', isManual);

    if (preset === 'adaptive' && inputNoiseDb) {
      inputNoiseDb.value = '-32';
    } else if (preset === 'clean_foh' && inputNoiseDb) {
      inputNoiseDb.value = '-38';
    } else if (preset === 'loud_concert' && inputNoiseDb) {
      inputNoiseDb.value = '-24';
    }
  }

  targetModeRadios.forEach(r => r.addEventListener('change', syncModeUI));
  detectPresetRadios.forEach(r => r.addEventListener('change', syncPresetUI));

  function populateTargetDropdown() {
    if (!targetFileSelect) return;
    targetFileSelect.replaceChildren();
    if (!dirInspectData) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Memuat daftar stem WAV...';
      targetFileSelect.appendChild(opt);
      return;
    }

    const mode = getTargetMode();
    const stemCandidates = Array.isArray(dirInspectData.stem_files) ? dirInspectData.stem_files : [];
    const allFiles = Array.isArray(dirInspectData.files) ? dirInspectData.files : [];
    const audioCandidates = stemCandidates.length > 0 ? stemCandidates : allFiles.filter(f => !f.is_video);
    const probedMap = dirInspectData.probed_files || {};

    if (audioCandidates.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '-- Tidak ada file WAV/Stem di folder ini --';
      targetFileSelect.appendChild(opt);
      return;
    }

    const recommended = dirInspectData.recommended_reference_stem;
    audioCandidates.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.rel_path;
      const pInfo = probedMap[item.rel_path];
      let extra = item.size_mb + ' MB';
      if (pInfo) {
        const chStr = pInfo.channels ? pInfo.channels + 'ch' : '';
        const durStr = pInfo.duration_label || '';
        extra = [durStr, chStr, item.size_mb + ' MB'].filter(Boolean).join(' • ');
      }
      opt.textContent = item.name + ' (' + extra + ')';
      if (mode === 'folder_stems' && recommended && item.rel_path === recommended) {
        opt.selected = true;
      }
      targetFileSelect.appendChild(opt);
    });
  }

  function updateSummaryPills(selectedProbe = null) {
    const mode = getTargetMode();
    if (sumTypePill) {
      sumTypePill.textContent =
        mode === 'folder_stems' ? 'Mode: Folder Multi-Stem WAV' : 'Mode: Single Multichannel WAV';
    }

    if (!dirInspectData) return;
    const probedMap = dirInspectData.probed_files || {};
    const chosenRel = targetFileSelect ? targetFileSelect.value : '';
    const probe = selectedProbe || probedMap[chosenRel] || dirInspectData.selected_probe || null;

    if (mode === 'folder_stems') {
      const stemCnt = dirInspectData.stem_count || 0;
      if (sumCountPill) {
        sumCountPill.textContent = stemCnt + ' Stem Track WAV';
        sumCountPill.className = 'summary-pill' + (stemCnt >= 2 ? ' accent' : '');
      }
    } else if (probe) {
      if (sumCountPill) {
        sumCountPill.textContent = (probe.channels || 2) + ' Channel Audio';
        sumCountPill.className = 'summary-pill accent';
      }
    } else if (sumCountPill) {
      sumCountPill.textContent = (dirInspectData.stem_count || 0) + ' File WAV';
      sumCountPill.className = 'summary-pill';
    }

    if (probe && probe.duration_s) {
      currentTotalDuration = Number(probe.duration_s) || 0;
      if (sumDurationPill) sumDurationPill.textContent = 'Durasi: ' + (probe.duration_label || formatTimeMMSS(currentTotalDuration));
      if (sumSpecPill) {
        const parts = [];
        if (probe.sample_rate_hz) parts.push(probe.sample_rate_hz + ' Hz');
        if (probe.audio_codec) parts.push(probe.audio_codec.toUpperCase());
        sumSpecPill.textContent = 'Format: ' + (parts.join(' • ') || 'PCM');
      }
    } else {
      if (sumDurationPill) sumDurationPill.textContent = 'Durasi: Siap Analisis';
      if (sumSpecPill) sumSpecPill.textContent = 'Format: PCM WAV';
    }
  }

  function renderSubfolderChips() {
    if (!subfolderChipsRow || !dirInspectData) return;
    subfolderChipsRow.replaceChildren();
    const subdirs = Array.isArray(dirInspectData.subdirs) ? dirInspectData.subdirs : [];

    const canGoUp =
      currentSourceDir &&
      defaultInboxDir &&
      currentSourceDir !== defaultInboxDir &&
      currentSourceDir.length > 1;

    if (subdirs.length === 0 && !canGoUp) {
      subfolderChipsRow.classList.add('hidden');
      return;
    }

    subfolderChipsRow.classList.remove('hidden');
    const lbl = document.createElement('span');
    lbl.className = 'subfolder-chip-label';
    lbl.textContent = 'Subfolder Sesi:';
    subfolderChipsRow.appendChild(lbl);

    if (canGoUp) {
      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'btn-chip';
      upBtn.textContent = '⬆️ Naik 1 Folder';
      upBtn.addEventListener('click', () => {
        const lastSlash = currentSourceDir.lastIndexOf('/');
        if (lastSlash > 0) {
          inspectDirectory(currentSourceDir.slice(0, lastSlash));
        }
      });
      subfolderChipsRow.appendChild(upBtn);
    }

    subdirs.forEach(sd => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'btn-chip';
      const suffix = sd.wav_count > 0 ? ' (' + sd.wav_count + ' WAV)' : '';
      chip.textContent = '📁 ' + sd.name + suffix;
      chip.addEventListener('click', () => inspectDirectory(sd.path));
      subfolderChipsRow.appendChild(chip);
    });
  }

  async function inspectDirectory(targetDir = '') {
    const { ok, data, error } = await apiPost('/api/splitter/inspect', {
      source_dir: targetDir || currentSourceDir || '',
      probe_detail: true,
    });
    if (!ok) {
      log('error', '[INSPECT] ' + (error || 'Gagal membaca folder sesi.'));
      notify({
        type: 'error',
        title: 'Gagal Membaca Folder',
        message: error || 'Tidak dapat memuat folder sesi.',
      });
      return;
    }

    dirInspectData = data;
    currentSourceDir = data.source_dir || '';
    if (data.default_inbox) defaultInboxDir = data.default_inbox;
    if (sourceDirInput) sourceDirInput.value = currentSourceDir;
    if (activeSourceBadge) activeSourceBadge.textContent = currentSourceDir;
    saveSharedWorkspaceState({ sourceDir: currentSourceDir });

    renderSubfolderChips();

    const stemFiles = Array.isArray(data.stem_files) ? data.stem_files : [];
    const probedMap = data.probed_files || {};
    const hasMultichannel = stemFiles.some(sf => {
      const p = probedMap[sf.rel_path];
      return p && Number(p.channels) > 2;
    });

    if (hasMultichannel && stemFiles.length === 1) {
      setTargetMode('multichannel_wav');
    } else {
      setTargetMode('folder_stems');
    }
  }

  if (targetFileSelect) {
    targetFileSelect.addEventListener('change', async () => {
      const rel = targetFileSelect.value;
      if (!rel || !dirInspectData) return;
      const cached = (dirInspectData.probed_files || {})[rel];
      if (cached) {
        updateSummaryPills(cached);
        return;
      }
      const { ok, data } = await apiPost('/api/splitter/inspect', {
        source_dir: currentSourceDir,
        target_rel: rel,
      });
      if (ok && data && data.selected_probe) {
        if (!dirInspectData.probed_files) dirInspectData.probed_files = {};
        dirInspectData.probed_files[rel] = data.selected_probe;
        updateSummaryPills(data.selected_probe);
      }
    });
  }

  function renderTimelineAndTable() {
    if (!segmentsTableBody || !timelineSegmentsTrack) return;
    segmentsTableBody.replaceChildren();
    timelineSegmentsTrack.replaceChildren();

    const activeSegments = segmentsList.filter(s => s.enabled !== false);
    const activeCount = activeSegments.length;

    if (btnExecuteSplit) btnExecuteSplit.disabled = activeCount === 0;
    if (btnExecuteSplitText) {
      btnExecuteSplitText.textContent = '2. Eksekusi Potong (' + activeCount + ' Lagu)';
    }
    if (btnExecuteSplitBottom) btnExecuteSplitBottom.disabled = activeCount === 0;
    if (btnExecuteSplitBottomText) {
      btnExecuteSplitBottomText.textContent = '✂️ Eksekusi Potong Multitrack (' + activeCount + ')';
    }

    if (segmentsList.length === 0) {
      const emptyHint = document.createElement('div');
      emptyHint.className = 'timeline-empty-hint';
      emptyHint.textContent = 'Klik "1. Deteksi Otomatis Titik Potong Lagu" untuk memvisualisasikan pembagian lagu di sini';
      timelineSegmentsTrack.appendChild(emptyHint);

      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = 'Belum ada daftar titik potong lagu. Klik tombol "1. Deteksi Otomatis Titik Potong Lagu" atau "+ Tambah Segmen".';
      tr.appendChild(td);
      segmentsTableBody.appendChild(tr);
      return;
    }

    const maxEnd = Math.max(
      currentTotalDuration || 0,
      ...segmentsList.map(s => Number(s.end_s) || 0),
      1
    );
    if (timelineTotalLabel) {
      timelineTotalLabel.textContent = 'Total Durasi: ' + formatTimeMMSS(maxEnd);
    }

    segmentsList.forEach((seg, idx) => {
      const dur = Math.max(1, (Number(seg.end_s) || 0) - (Number(seg.start_s) || 0));
      const pct = Math.max(2, (dur / maxEnd) * 100);
      const block = document.createElement('div');
      block.className = 'timeline-seg-block' + (seg.enabled === false ? ' disabled' : '');
      block.style.width = pct + '%';
      block.title =
        '#' +
        String(idx + 1).padStart(2, '0') +
        ' ' +
        seg.title +
        ' (' +
        formatTimeMMSS(seg.start_s) +
        ' - ' +
        formatTimeMMSS(seg.end_s) +
        ')';
      block.textContent = String(idx + 1).padStart(2, '0') + '. ' + seg.title;
      timelineSegmentsTrack.appendChild(block);
    });

    segmentsList.forEach((seg, idx) => {
      const tr = document.createElement('tr');
      if (seg.enabled === false) tr.classList.add('row-muted');

      // 1. Checkbox
      const tdCheck = document.createElement('td');
      tdCheck.className = 'col-check';
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = seg.enabled !== false;
      chk.addEventListener('change', () => {
        seg.enabled = chk.checked;
        renderTimelineAndTable();
      });
      tdCheck.appendChild(chk);

      // 2. Index
      const tdIdx = document.createElement('td');
      tdIdx.className = 'col-idx';
      tdIdx.textContent = '#' + String(idx + 1).padStart(2, '0');

      // 3. Editable Song Title / Folder Name
      const tdTitle = document.createElement('td');
      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'seg-title-input';
      titleInput.value = seg.title || 'Lagu ' + String(idx + 1).padStart(2, '0');
      titleInput.addEventListener('input', () => {
        seg.title = titleInput.value;
      });
      titleInput.addEventListener('blur', () => {
        renderTimelineAndTable();
      });
      tdTitle.appendChild(titleInput);

      // 4. Start Time
      const tdStart = document.createElement('td');
      const startInput = document.createElement('input');
      startInput.type = 'text';
      startInput.className = 'seg-time-input';
      startInput.value = formatTimeInput(seg.start_s);
      startInput.addEventListener('change', () => {
        const parsed = parseTimeInput(startInput.value);
        if (parsed !== null && parsed < seg.end_s) {
          seg.start_s = Number(parsed.toFixed(2));
          seg.duration_s = Number((seg.end_s - seg.start_s).toFixed(2));
          renderTimelineAndTable();
        } else {
          startInput.value = formatTimeInput(seg.start_s);
          notify({
            type: 'warning',
            title: 'Waktu Mulai Tidak Valid',
            message: 'Waktu mulai harus berformat MM:SS / HH:MM:SS dan lebih kecil dari Waktu Selesai.',
          });
        }
      });
      tdStart.appendChild(startInput);

      // 5. End Time
      const tdEnd = document.createElement('td');
      const endInput = document.createElement('input');
      endInput.type = 'text';
      endInput.className = 'seg-time-input';
      endInput.value = formatTimeInput(seg.end_s);
      endInput.addEventListener('change', () => {
        const parsed = parseTimeInput(endInput.value);
        if (parsed !== null && parsed > seg.start_s) {
          seg.end_s = Number(parsed.toFixed(2));
          seg.duration_s = Number((seg.end_s - seg.start_s).toFixed(2));
          renderTimelineAndTable();
        } else {
          endInput.value = formatTimeInput(seg.end_s);
          notify({
            type: 'warning',
            title: 'Waktu Selesai Tidak Valid',
            message: 'Waktu selesai harus berformat MM:SS / HH:MM:SS dan lebih besar dari Waktu Mulai.',
          });
        }
      });
      tdEnd.appendChild(endInput);

      // 6. Duration Badge
      const tdDur = document.createElement('td');
      const durBadge = document.createElement('span');
      durBadge.className = 'format-badge cyan';
      const durSec = Math.max(0, (Number(seg.end_s) || 0) - (Number(seg.start_s) || 0));
      durBadge.textContent = formatTimeMMSS(durSec) + ' (' + durSec.toFixed(1) + 's)';
      tdDur.appendChild(durBadge);

      // 7. Actions (Split 2, Merge, Delete)
      const tdAct = document.createElement('td');
      const actWrap = document.createElement('div');
      actWrap.className = 'seg-actions-cell';

      const btnSplitSeg = document.createElement('button');
      btnSplitSeg.type = 'button';
      btnSplitSeg.className = 'btn-seg-action';
      btnSplitSeg.textContent = '➗ Bagi 2';
      btnSplitSeg.title = 'Bagi segmen lagu ini menjadi 2 bagian di titik tengahnya';
      btnSplitSeg.addEventListener('click', () => {
        const mid = Number(((seg.start_s + seg.end_s) / 2).toFixed(2));
        if (mid <= seg.start_s + 1 || mid >= seg.end_s - 1) return;
        const secondHalf = {
          enabled: true,
          title: seg.title + ' (Bagian 2)',
          start_s: mid,
          end_s: seg.end_s,
          duration_s: Number((seg.end_s - mid).toFixed(2)),
        };
        seg.end_s = mid;
        seg.duration_s = Number((mid - seg.start_s).toFixed(2));
        segmentsList.splice(idx + 1, 0, secondHalf);
        renderTimelineAndTable();
      });
      actWrap.appendChild(btnSplitSeg);

      if (idx + 1 < segmentsList.length) {
        const btnMerge = document.createElement('button');
        btnMerge.type = 'button';
        btnMerge.className = 'btn-seg-action';
        btnMerge.textContent = '🔗 Gabung';
        btnMerge.title = 'Gabungkan segmen ini dengan lagu berikutnya';
        btnMerge.addEventListener('click', () => {
          const nextSeg = segmentsList[idx + 1];
          seg.end_s = nextSeg.end_s;
          seg.duration_s = Number((seg.end_s - seg.start_s).toFixed(2));
          segmentsList.splice(idx + 1, 1);
          renderTimelineAndTable();
        });
        actWrap.appendChild(btnMerge);
      }

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'btn-seg-action danger';
      btnDel.textContent = '✕';
      btnDel.title = 'Hapus segmen lagu ini dari daftar potong';
      btnDel.addEventListener('click', () => {
        segmentsList.splice(idx, 1);
        renderTimelineAndTable();
      });
      actWrap.appendChild(btnDel);

      tdAct.appendChild(actWrap);

      tr.appendChild(tdCheck);
      tr.appendChild(tdIdx);
      tr.appendChild(tdTitle);
      tr.appendChild(tdStart);
      tr.appendChild(tdEnd);
      tr.appendChild(tdDur);
      tr.appendChild(tdAct);
      segmentsTableBody.appendChild(tr);
    });
  }

  if (chkAllSegments) {
    chkAllSegments.addEventListener('change', () => {
      const checked = chkAllSegments.checked;
      segmentsList.forEach(s => {
        s.enabled = checked;
      });
      renderTimelineAndTable();
    });
  }

  if (btnAddSegmentRow) {
    btnAddSegmentRow.addEventListener('click', () => {
      const lastEnd = segmentsList.length > 0 ? Number(segmentsList[segmentsList.length - 1].end_s) || 0 : 0;
      const defaultEnd = currentTotalDuration > lastEnd ? currentTotalDuration : lastEnd + 240;
      const newIdx = segmentsList.length + 1;
      segmentsList.push({
        enabled: true,
        title: 'Lagu ' + String(newIdx).padStart(2, '0'),
        start_s: lastEnd,
        end_s: Number(defaultEnd.toFixed(2)),
        duration_s: Number((defaultEnd - lastEnd).toFixed(2)),
      });
      renderTimelineAndTable();
    });
  }

  if (btnAutoNumberTitles) {
    btnAutoNumberTitles.addEventListener('click', () => {
      segmentsList.forEach((seg, i) => {
        const cleaned = String(seg.title || '').replace(/^Lagu\s+\d+\s*/i, '').trim();
        seg.title = cleaned ? cleaned : 'Lagu ' + String(i + 1).padStart(2, '0');
      });
      renderTimelineAndTable();
      notify({
        type: 'info',
        title: 'Judul Lagu Diurutkan',
        message: 'Penomoran subfolder lagu telah diperbarui.',
        duration: 2500,
      });
    });
  }

  // Step 1: Detect Segments
  async function handleDetectSegments() {
    const mode = getTargetMode();
    const preset = getDetectPreset();
    const chosenRel = targetFileSelect ? targetFileSelect.value : '';

    if (btnDetectSegments) btnDetectSegments.disabled = true;
    if (btnDetectSegmentsText) btnDetectSegmentsText.textContent = 'Menganalisis Stem & Jeda Lagu...';
    log('info', '[DETECT] Menganalisis track referensi multitrack untuk jeda lagu...');

    const detectMode =
      preset === 'manual' ? 'manual' : preset === 'adaptive' ? 'adaptive' : 'silence';

    const payload = {
      source_dir: currentSourceDir,
      target_rel: mode === 'folder_stems' ? '' : chosenRel,
      target_mode: mode,
      detect_mode: detectMode,
      noise_db: parseFloat(inputNoiseDb ? inputNoiseDb.value : '-32') || -32.0,
      min_silence_s: parseFloat(inputMinSilence ? inputMinSilence.value : '2.5') || 2.5,
      min_song_s: parseFloat(inputMinSong ? inputMinSong.value : '60') || 60.0,
      pad_before_s: parseFloat(inputPadBefore ? inputPadBefore.value : '0.5') || 0.5,
      pad_after_s: parseFloat(inputPadAfter ? inputPadAfter.value : '1.0') || 1.0,
      trim_silence_edges: true,
      reference_stem: mode === 'folder_stems' ? chosenRel : '',
      channel_mode: channelModeSelect ? channelModeSelect.value : 'auto',
      manual_timestamps: preset === 'manual' && manualTimestampsInput ? manualTimestampsInput.value : '',
    };

    const { ok, data, error } = await apiPost('/api/splitter/detect', payload);
    if (btnDetectSegments) btnDetectSegments.disabled = false;
    if (btnDetectSegmentsText) btnDetectSegmentsText.textContent = '1. Deteksi Otomatis Titik Potong Lagu';

    if (!ok || !data) {
      const errMsg = error || 'Gagal mendeteksi batas lagu multitrack.';
      log('error', '[DETECT ERROR] ' + errMsg);
      notify({
        type: 'error',
        title: 'Deteksi Jeda Gagal',
        message: errMsg,
        playSound: true,
      });
      return;
    }

    currentTotalDuration = Number(data.duration_s) || 0;
    segmentsList = (Array.isArray(data.segments) ? data.segments : []).map(s => ({
      ...s,
      enabled: true,
    }));

    if (timelineTargetLabel) {
      timelineTargetLabel.textContent =
        'Sesi: ' + (data.target_name || '') + ' (Ref Track: ' + (data.reference_file || '') + ')';
    }
    if (detectionResultSub && data.detection_note) {
      detectionResultSub.textContent = data.detection_note;
    }

    log('info', '[DETECT] ' + (data.detection_note || 'Deteksi selesai.'));
    renderTimelineAndTable();
    updateSummaryPills(data);

    notify({
      type: segmentsList.length > 1 ? 'success' : 'warning',
      title: 'Deteksi Selesai (' + segmentsList.length + ' Lagu)',
      message: data.detection_note || 'Tinjau daftar lagu di bawah sebelum eksekusi.',
      duration: 4500,
    });
  }

  if (btnDetectSegments) {
    btnDetectSegments.addEventListener('click', handleDetectSegments);
  }

  // Step 2: Execute Split
  async function handleExecuteSplit() {
    const activeSegments = segmentsList.filter(s => s.enabled !== false);
    if (activeSegments.length === 0) {
      notify({
        type: 'warning',
        title: 'Tidak Ada Lagu Aktif',
        message: 'Centang minimal 1 lagu pada tabel di bawah untuk dipotong.',
      });
      return;
    }

    const mode = getTargetMode();
    const chosenRel = targetFileSelect ? targetFileSelect.value : '';

    const payload = {
      source_dir: currentSourceDir,
      target_rel: mode === 'folder_stems' ? '' : chosenRel,
      dest_dir: destDirInput ? destDirInput.value.trim() : '',
      target_mode: mode,
      multichannel_mode: getRadioVal(multichannelModeRadios, 'keep_multichannel'),
      stem_org_mode: getRadioVal(stemOrgRadios, 'folder_per_song'),
      segments: activeSegments,
    };

    const { ok, data, error } = await apiPost('/api/splitter/execute', payload);
    if (!ok) {
      const errMsg = error || 'Gagal menambahkan tugas pemotongan ke antrian.';
      log('error', '[SPLIT ERROR] ' + errMsg);
      notify({
        type: 'error',
        title: 'Gagal Memulai Pemotongan',
        message: errMsg,
        playSound: true,
      });
      return;
    }

    log('info', '[QUEUE] ' + (data.message || 'Tugas pemotongan masuk ke antrian.'));
    notify({
      type: 'info',
      title: 'Proses Pemotongan Multitrack Dimulai',
      message: data.message || 'FFmpeg sedang memotong stem per lagu (PCM Copy)...',
      duration: 4000,
    });
    queueMonitor.startPolling();
  }

  if (btnExecuteSplit) btnExecuteSplit.addEventListener('click', handleExecuteSplit);
  if (btnExecuteSplitBottom) btnExecuteSplitBottom.addEventListener('click', handleExecuteSplit);

  if (btnRefreshSource) {
    btnRefreshSource.addEventListener('click', () => inspectDirectory(currentSourceDir));
  }
  if (btnOpenSourceExplorer) {
    btnOpenSourceExplorer.addEventListener('click', () => openFolderInExplorer('', currentSourceDir));
  }
  if (btnClearDest && destDirInput) {
    btnClearDest.addEventListener('click', () => {
      destDirInput.value = '';
    });
  }

  // Folder Browser Modal
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
    getStartPath: m => {
      if (m === 'dest' && destDirInput && destDirInput.value) {
        return destDirInput.value;
      }
      return currentSourceDir || '';
    },
    onSelectSource: chosenPath => inspectDirectory(chosenPath),
    onSelectDest: chosenPath => {
      if (destDirInput) destDirInput.value = chosenPath;
    },
    onLog: log,
  });

  const queueMonitor = createQueueMonitor({
    queueCounterEl: queueCounter,
    jobStatusTagEl: jobStatusTag,
    jobUrlLabelEl: jobUrlLabel,
    progressFillEl: progressFill,
    progressTextEl: progressText,
    terminalLogsEl: terminalLogs,
    idleText: 'Siap mendeteksi & memotong multitrack per lagu',
    onTaskFinished: finishedTask => {
      if (finishedTask.type === 'split' && finishedTask.status === 'SUCCESS') {
        inspectDirectory(currentSourceDir);
      }
    },
  });

  syncModeUI();
  syncPresetUI();
  inspectDirectory(currentSourceDir);
  queueMonitor.pollOnce();
});

