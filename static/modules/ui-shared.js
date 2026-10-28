/**
 * Audio Lab - Shared UI Utilities & Components (App Header, Grouping, Logs, Queue Monitor, System Status)
 * Strict DOM Manipulation (No innerHTML, strictly textContent, createElement & createElementNS)
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Helper to create an SVG element with attributes and child shapes without innerHTML.
 * @param {Array<{ tag: string, attrs: Record<string, string> }>} shapes
 * @param {Record<string, string>} rootAttrs
 * @returns {SVGSVGElement}
 */
function createSvgIcon(shapes, rootAttrs = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  Object.entries(rootAttrs).forEach(([k, v]) => svg.setAttribute(k, v));

  shapes.forEach(({ tag, attrs }) => {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    svg.appendChild(el);
  });
  return svg;
}

/**
 * Shared Top Header & Navigation Component.
 * Mounts identical Brand, Navigation Tabs, and System Diagnostics Bar across all pages,
 * and automatically fetches /api/system to update the status pills.
 *
 * @param {{
 *   activePage?: 'ingest' | 'converter',
 *   onSystemData?: (data: any) => void,
 *   onSystemError?: (err: Error) => void
 * }} opts
 */
export function initAppHeader(opts = {}) {
  const headerEl = document.getElementById('appHeader') || document.querySelector('.app-header');
  if (!headerEl) return {};

  const activePage = opts.activePage || headerEl.dataset.page || 'ingest';
  headerEl.replaceChildren();

  // 1. Brand Block
  const brand = document.createElement('div');
  brand.className = 'brand';

  const brandIcon = document.createElement('div');
  brandIcon.className = 'brand-icon';
  brandIcon.appendChild(
    createSvgIcon(
      [
        { tag: 'path', attrs: { d: 'M9 18V5l12-2v13' } },
        { tag: 'circle', attrs: { cx: '6', cy: '18', r: '3' } },
        { tag: 'circle', attrs: { cx: '18', cy: '16', r: '3' } },
      ],
      { 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
    )
  );

  const brandInfo = document.createElement('div');
  brandInfo.className = 'brand-info';

  const brandTitle = document.createElement('h1');
  brandTitle.className = 'brand-title';
  brandTitle.appendChild(document.createTextNode('AUDIO LAB '));
  const studioBadge = document.createElement('span');
  studioBadge.className = 'badge-studio';
  studioBadge.textContent = 'PRO FOH';
  brandTitle.appendChild(studioBadge);

  const brandSubtitle = document.createElement('p');
  brandSubtitle.className = 'brand-subtitle';
  brandSubtitle.textContent = 'High-Fidelity Ingestion, SoXR Converter & Soundsystem QC';

  brandInfo.appendChild(brandTitle);
  brandInfo.appendChild(brandSubtitle);
  brand.appendChild(brandIcon);
  brand.appendChild(brandInfo);

  // 2. Navigation Tabs
  const nav = document.createElement('nav');
  nav.className = 'app-nav';
  nav.setAttribute('aria-label', 'Main Navigation');

  const tabIngest = document.createElement('a');
  tabIngest.href = '/';
  tabIngest.className = 'nav-tab' + (activePage === 'ingest' ? ' active' : '');
  tabIngest.appendChild(
    createSvgIcon([
      { tag: 'path', attrs: { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' } },
      { tag: 'polyline', attrs: { points: '7 10 12 15 17 10' } },
      { tag: 'line', attrs: { x1: '12', y1: '15', x2: '12', y2: '3' } },
    ])
  );
  const tabIngestSpan = document.createElement('span');
  tabIngestSpan.textContent = 'Ingestion & QC';
  tabIngest.appendChild(tabIngestSpan);

  const tabConverter = document.createElement('a');
  tabConverter.href = '/converter';
  tabConverter.className = 'nav-tab' + (activePage === 'converter' ? ' active' : '');
  tabConverter.appendChild(
    createSvgIcon([
      { tag: 'polyline', attrs: { points: '17 1 21 5 17 9' } },
      { tag: 'path', attrs: { d: 'M3 11V9a4 4 0 0 1 4-4h14' } },
      { tag: 'polyline', attrs: { points: '7 23 3 19 7 15' } },
      { tag: 'path', attrs: { d: 'M21 13v2a4 4 0 0 1-4 4H3' } },
    ])
  );
  const tabConverterSpan = document.createElement('span');
  tabConverterSpan.textContent = 'Sample Rate Converter';
  tabConverter.appendChild(tabConverterSpan);

  nav.appendChild(tabIngest);
  nav.appendChild(tabConverter);

  // 3. Unified System Diagnostics Bar
  const statusGroup = document.createElement('div');
  statusGroup.className = 'system-status-group';
  statusGroup.id = 'systemStatusGroup';

  function createPill(pillId, dotId, labelText, valId, defaultVal, isDotActive = false) {
    const pill = document.createElement('div');
    pill.className = 'status-pill';
    if (pillId) pill.id = pillId;

    const dot = document.createElement('span');
    dot.className = 'status-indicator' + (isDotActive ? ' active' : '');
    if (dotId) dot.id = dotId;

    const label = document.createElement('span');
    label.className = 'status-label';
    label.textContent = labelText;

    const val = document.createElement('span');
    val.className = 'status-val';
    if (valId) val.id = valId;
    val.textContent = defaultVal;

    pill.appendChild(dot);
    pill.appendChild(label);
    pill.appendChild(val);
    return { pill, dot, val };
  }

  const pyPill = createPill('statusPython', null, 'Python:', 'pythonVal', '3.12', true);
  const ytdlpPill = createPill('statusYtdlp', 'ytdlpDot', 'yt-dlp:', 'ytdlpVal', 'checking...');
  const ffmpegPill = createPill('statusFfmpeg', 'ffmpegDot', 'FFmpeg:', 'ffmpegVal', 'checking...');
  const cookiesPill = createPill('statusCookies', 'cookiesDot', 'Premium:', 'cookiesVal', 'checking...');

  statusGroup.appendChild(pyPill.pill);
  statusGroup.appendChild(ytdlpPill.pill);
  statusGroup.appendChild(ffmpegPill.pill);
  statusGroup.appendChild(cookiesPill.pill);

  // 4. Notification Bell & History Popover in Header
  const notifWrapper = createHeaderNotificationCenter();
  statusGroup.appendChild(notifWrapper);

  headerEl.appendChild(brand);
  headerEl.appendChild(nav);
  headerEl.appendChild(statusGroup);

  function refreshStatus() {
    return checkSystemStatus({
      pythonVal: pyPill.val,
      ytdlpDot: ytdlpPill.dot,
      ytdlpVal: ytdlpPill.val,
      ffmpegDot: ffmpegPill.dot,
      ffmpegVal: ffmpegPill.val,
      requireFfprobe: true,
      cookiesDot: cookiesPill.dot,
      cookiesVal: cookiesPill.val,
      onData: opts.onSystemData,
      onError: opts.onSystemError,
    });
  }

  refreshStatus();
  return { refreshStatus };
}

/* ==========================================================================
   Notification Engine (Toast Stack + Header History Center + Studio Chime)
   ========================================================================== */
const NOTIF_HISTORY_KEY = 'audio_lab_notif_history';
const NOTIF_SEEN_TASKS_KEY = 'audio_lab_seen_tasks';
const NOTIF_SOUND_KEY = 'audio_lab_notif_sound';
const MAX_NOTIF_HISTORY = 25;

let unreadNotifCount = 0;
let notifBellBadgeEl = null;
let notifListContainerEl = null;
let audioCtxInstance = null;

function isSoundEnabled() {
  try {
    const val = sessionStorage.getItem(NOTIF_SOUND_KEY);
    return val === null ? true : val === '1';
  } catch (_) {
    return true;
  }
}

function setSoundEnabled(enabled) {
  try {
    sessionStorage.setItem(NOTIF_SOUND_KEY, enabled ? '1' : '0');
  } catch (_) {
    // Ignore storage quota errors
  }
}

/**
 * Plays a subtle synthesized Web Audio API studio chime for task completion/alerts.
 * @param {'success' | 'exists' | 'warning' | 'error' | 'info'} type
 */
export function playNotificationSound(type) {
  if (!isSoundEnabled() || type === 'info') return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioCtxInstance) {
      audioCtxInstance = new AudioCtx();
    }
    if (audioCtxInstance.state === 'suspended') {
      audioCtxInstance.resume().catch(() => {});
    }
    const now = audioCtxInstance.currentTime;

    const playTone = (freq, startOffset, duration, wave = 'sine', peakGain = 0.055) => {
      const osc = audioCtxInstance.createOscillator();
      const gain = audioCtxInstance.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0.0001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(peakGain, now + startOffset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(audioCtxInstance.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.01);
    };

    if (type === 'success') {
      // Ascending C5 -> E5 -> G5 studio triad
      playTone(523.25, 0.0, 0.14, 'sine', 0.05);
      playTone(659.25, 0.09, 0.16, 'sine', 0.05);
      playTone(783.99, 0.18, 0.24, 'sine', 0.055);
    } else if (type === 'exists') {
      // Soft double-tap A4 -> C5 (file already exists / skipped)
      playTone(440.0, 0.0, 0.11, 'triangle', 0.045);
      playTone(523.25, 0.12, 0.16, 'triangle', 0.045);
    } else if (type === 'warning') {
      // Mid alert E4 -> C4
      playTone(392.0, 0.0, 0.15, 'triangle', 0.055);
      playTone(329.63, 0.14, 0.22, 'triangle', 0.055);
    } else if (type === 'error') {
      // Low descending alert
      playTone(311.13, 0.0, 0.16, 'sawtooth', 0.04);
      playTone(233.08, 0.15, 0.26, 'sawtooth', 0.045);
    }
  } catch (_) {
    // Ignore audio context autoplay restrictions
  }
}

function loadNotifHistory() {
  try {
    const raw = sessionStorage.getItem(NOTIF_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function saveNotifHistory(items) {
  try {
    sessionStorage.setItem(NOTIF_HISTORY_KEY, JSON.stringify(items.slice(0, MAX_NOTIF_HISTORY)));
  } catch (_) {
    // Ignore storage errors
  }
}

function getNotifIconSvg(type) {
  if (type === 'success') {
    return createSvgIcon([
      { tag: 'path', attrs: { d: 'M22 11.08V12a10 10 0 1 1-5.93-9.14' } },
      { tag: 'polyline', attrs: { points: '22 4 12 14.01 9 11.01' } },
    ]);
  }
  if (type === 'exists') {
    return createSvgIcon([
      { tag: 'path', attrs: { d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' } },
      { tag: 'polyline', attrs: { points: '9 14 11 16 15 12' } },
    ]);
  }
  if (type === 'warning') {
    return createSvgIcon([
      { tag: 'path', attrs: { d: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' } },
      { tag: 'line', attrs: { x1: '12', y1: '9', x2: '12', y2: '13' } },
      { tag: 'line', attrs: { x1: '12', y1: '17', x2: '12.01', y2: '17' } },
    ]);
  }
  if (type === 'error') {
    return createSvgIcon([
      { tag: 'circle', attrs: { cx: '12', cy: '12', r: '10' } },
      { tag: 'line', attrs: { x1: '15', y1: '9', x2: '9', y2: '15' } },
      { tag: 'line', attrs: { x1: '9', y1: '9', x2: '15', y2: '15' } },
    ]);
  }
  return createSvgIcon([
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '10' } },
    { tag: 'line', attrs: { x1: '12', y1: '16', x2: '12', y2: '12' } },
    { tag: 'line', attrs: { x1: '12', y1: '8', x2: '12.01', y2: '8' } },
  ]);
}

function getNotifBadgeLabel(type) {
  if (type === 'success') return 'BERHASIL';
  if (type === 'exists') return 'SUDAH ADA';
  if (type === 'warning') return 'PERHATIAN';
  if (type === 'error') return 'GAGAL';
  return 'INFO';
}

function formatTimeShort(ts) {
  const d = ts ? new Date(ts) : new Date();
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function updateNotifBellBadge() {
  if (!notifBellBadgeEl) return;
  if (unreadNotifCount > 0) {
    notifBellBadgeEl.textContent = unreadNotifCount > 9 ? '9+' : String(unreadNotifCount);
    notifBellBadgeEl.classList.remove('hidden');
  } else {
    notifBellBadgeEl.textContent = '0';
    notifBellBadgeEl.classList.add('hidden');
  }
}

function renderNotifHistoryList() {
  if (!notifListContainerEl) return;
  notifListContainerEl.replaceChildren();
  const history = loadNotifHistory();

  if (history.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'notif-empty';
    empty.textContent = 'Belum ada riwayat notifikasi pada sesi ini.';
    notifListContainerEl.appendChild(empty);
    return;
  }

  history.forEach(item => {
    const row = document.createElement('div');
    row.className = 'notif-history-item type-' + (item.type || 'info');

    const iconWrap = document.createElement('div');
    iconWrap.className = 'notif-item-icon';
    iconWrap.appendChild(getNotifIconSvg(item.type || 'info'));

    const body = document.createElement('div');
    body.className = 'notif-item-body';

    const topLine = document.createElement('div');
    topLine.className = 'notif-item-top';

    const badge = document.createElement('span');
    badge.className = 'notif-type-tag ' + (item.type || 'info');
    badge.textContent = getNotifBadgeLabel(item.type || 'info');

    const titleSpan = document.createElement('span');
    titleSpan.className = 'notif-item-title';
    titleSpan.textContent = item.title || 'Notifikasi';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'notif-item-time';
    timeSpan.textContent = item.time || '';

    topLine.appendChild(badge);
    topLine.appendChild(titleSpan);
    topLine.appendChild(timeSpan);

    const msgP = document.createElement('p');
    msgP.className = 'notif-item-msg';
    msgP.textContent = item.message || '';

    body.appendChild(topLine);
    body.appendChild(msgP);

    row.appendChild(iconWrap);
    row.appendChild(body);
    notifListContainerEl.appendChild(row);
  });
}

function createHeaderNotificationCenter() {
  const wrapper = document.createElement('div');
  wrapper.className = 'notif-center-wrapper';

  const bellBtn = document.createElement('button');
  bellBtn.type = 'button';
  bellBtn.className = 'notif-bell-btn';
  bellBtn.id = 'notifBellBtn';
  bellBtn.title = 'Riwayat Notifikasi';
  bellBtn.setAttribute('aria-label', 'Buka Riwayat Notifikasi');

  bellBtn.appendChild(
    createSvgIcon([
      { tag: 'path', attrs: { d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' } },
      { tag: 'path', attrs: { d: 'M13.73 21a2 2 0 0 1-3.46 0' } },
    ])
  );

  const badge = document.createElement('span');
  badge.className = 'notif-bell-badge hidden';
  badge.id = 'notifBellBadge';
  badge.textContent = '0';
  notifBellBadgeEl = badge;
  bellBtn.appendChild(badge);

  const popover = document.createElement('div');
  popover.className = 'notif-popover hidden';
  popover.id = 'notifPopover';

  const popHeader = document.createElement('div');
  popHeader.className = 'notif-popover-header';

  const popTitle = document.createElement('span');
  popTitle.className = 'notif-popover-title';
  popTitle.textContent = 'Pusat Notifikasi';

  const popActions = document.createElement('div');
  popActions.className = 'notif-popover-actions';

  const soundBtn = document.createElement('button');
  soundBtn.type = 'button';
  soundBtn.className = 'btn-notif-action';
  const updateSoundBtnLabel = () => {
    soundBtn.textContent = isSoundEnabled() ? '🔔 Suara: ON' : '🔕 Suara: OFF';
  };
  updateSoundBtnLabel();
  soundBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const next = !isSoundEnabled();
    setSoundEnabled(next);
    updateSoundBtnLabel();
    if (next) playNotificationSound('success');
  });

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'btn-notif-action';
  clearBtn.textContent = 'Bersihkan';
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    saveNotifHistory([]);
    unreadNotifCount = 0;
    updateNotifBellBadge();
    renderNotifHistoryList();
  });

  popActions.appendChild(soundBtn);
  popActions.appendChild(clearBtn);
  popHeader.appendChild(popTitle);
  popHeader.appendChild(popActions);

  const listContainer = document.createElement('div');
  listContainer.className = 'notif-popover-list';
  notifListContainerEl = listContainer;

  popover.appendChild(popHeader);
  popover.appendChild(listContainer);

  bellBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = popover.classList.toggle('hidden');
    if (!isHidden) {
      unreadNotifCount = 0;
      updateNotifBellBadge();
      renderNotifHistoryList();
    }
  });

  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      popover.classList.add('hidden');
    }
  });

  wrapper.appendChild(bellBtn);
  wrapper.appendChild(popover);
  renderNotifHistoryList();
  return wrapper;
}

function getOrCreateToastContainer() {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'false');
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Displays a floating studio toast notification and logs it to the Notification Center.
 * @param {{
 *   type?: 'success' | 'exists' | 'warning' | 'error' | 'info',
 *   title: string,
 *   message: string,
 *   duration?: number,
 *   playSound?: boolean,
 *   recordHistory?: boolean
 * }} opts
 */
export function notify(opts) {
  if (!opts || (!opts.title && !opts.message)) return;
  const type = opts.type || 'info';
  const title = opts.title || 'Notifikasi';
  const message = opts.message || '';
  const timeStr = formatTimeShort(Date.now());
  const defaultDuration = type === 'error' ? 9000 : (type === 'warning' || type === 'exists' ? 7500 : 5500);
  const duration = typeof opts.duration === 'number' ? opts.duration : defaultDuration;

  if (opts.recordHistory !== false) {
    const history = loadNotifHistory();
    history.unshift({ type, title, message, time: timeStr });
    saveNotifHistory(history);
    const popover = document.getElementById('notifPopover');
    if (!popover || popover.classList.contains('hidden')) {
      unreadNotifCount += 1;
      updateNotifBellBadge();
    } else {
      renderNotifHistoryList();
    }
  }

  if (opts.playSound) {
    playNotificationSound(type);
  }

  const container = getOrCreateToastContainer();
  const toast = document.createElement('div');
  toast.className = 'toast-card toast-' + type;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const iconBox = document.createElement('div');
  iconBox.className = 'toast-icon';
  iconBox.appendChild(getNotifIconSvg(type));

  const content = document.createElement('div');
  content.className = 'toast-content';

  const headerRow = document.createElement('div');
  headerRow.className = 'toast-header-row';

  const badge = document.createElement('span');
  badge.className = 'notif-type-tag ' + type;
  badge.textContent = getNotifBadgeLabel(type);

  const titleEl = document.createElement('strong');
  titleEl.className = 'toast-title';
  titleEl.textContent = title;

  const timeEl = document.createElement('span');
  timeEl.className = 'toast-time';
  timeEl.textContent = timeStr;

  headerRow.appendChild(badge);
  headerRow.appendChild(titleEl);
  headerRow.appendChild(timeEl);

  const msgEl = document.createElement('p');
  msgEl.className = 'toast-message';
  msgEl.textContent = message;

  content.appendChild(headerRow);
  content.appendChild(msgEl);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'toast-close-btn';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Tutup notifikasi');

  const progressTrack = document.createElement('div');
  progressTrack.className = 'toast-progress-track';
  const progressBar = document.createElement('div');
  progressBar.className = 'toast-progress-bar';
  progressBar.style.animationDuration = duration + 'ms';
  progressTrack.appendChild(progressBar);

  let dismissed = false;
  let timerId = null;

  const dismissToast = () => {
    if (dismissed) return;
    dismissed = true;
    if (timerId) clearTimeout(timerId);
    toast.classList.add('toast-leaving');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 220);
  };

  closeBtn.addEventListener('click', dismissToast);

  toast.addEventListener('mouseenter', () => {
    if (timerId) clearTimeout(timerId);
    progressBar.style.animationPlayState = 'paused';
  });

  toast.addEventListener('mouseleave', () => {
    progressBar.style.animationPlayState = 'running';
    timerId = setTimeout(dismissToast, Math.max(2000, Math.round(duration * 0.45)));
  });

  toast.appendChild(iconBox);
  toast.appendChild(content);
  toast.appendChild(closeBtn);
  toast.appendChild(progressTrack);

  container.appendChild(toast);
  timerId = setTimeout(dismissToast, duration);
}


/**
 * Appends a single log line to a terminal container element.
 * @param {HTMLElement | null} terminalEl
 * @param {'info' | 'warn' | 'error'} level
 * @param {string} message
 */
export function appendLog(terminalEl, level, message) {
  if (!terminalEl) return;
  const p = document.createElement('p');
  p.className = 'log-line ' + level;
  p.textContent = message;
  terminalEl.appendChild(p);
  terminalEl.scrollTop = terminalEl.scrollHeight;
}

/**
 * Replaces terminal container contents with an array of log strings.
 * @param {HTMLElement | null} terminalEl
 * @param {string[]} logs
 */
export function renderLogs(terminalEl, logs) {
  if (!terminalEl || !Array.isArray(logs)) return;
  terminalEl.replaceChildren();
  logs.forEach(msg => {
    const p = document.createElement('p');
    let lvl = 'info';
    if (msg.includes('ERROR') || msg.includes('Failed')) {
      lvl = 'error';
    } else if (msg.includes('WARNING') || msg.includes('SKIPPED') || msg.includes('caution')) {
      lvl = 'warn';
    }
    p.className = 'log-line ' + lvl;
    p.textContent = msg;
    terminalEl.appendChild(p);
  });
  terminalEl.scrollTop = terminalEl.scrollHeight;
}

/**
 * Groups an array of file objects by their folder/playlist name.
 * @param {Array<any>} files
 * @returns {Array<{
 *   key: string,
 *   label: string,
 *   isRoot: boolean,
 *   files: Array<any>,
 *   totalSizeMb: number,
 *   mp3Count: number,
 *   otherCount: number
 * }>}
 */
export function groupFilesByFolder(files) {
  const map = new Map();
  files.forEach(f => {
    const folder = f.folder || '';
    const key = folder || '__ROOT__';
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: folder ? folder : 'File di Root (Inbox)',
        isRoot: !folder,
        files: [],
        totalSizeMb: 0,
        mp3Count: 0,
        otherCount: 0,
      });
    }
    const g = map.get(key);
    g.files.push(f);
    g.totalSizeMb += Number(f.size_mb || 0);
    if (f.ext === '.mp3') g.mp3Count += 1;
    else g.otherCount += 1;
  });

  const groups = Array.from(map.values());
  groups.forEach(g => {
    g.totalSizeMb = Math.round(g.totalSizeMb * 10) / 10;
  });
  return groups;
}

/**
 * Builds the inner bar of a collapsible folder group header row.
 * @param {{
 *   key: string,
 *   label: string,
 *   isRoot: boolean,
 *   files: Array<any>,
 *   totalSizeMb: number,
 *   mp3Count: number,
 *   otherCount: number
 * }} group
 * @param {boolean} isCollapsed
 * @returns {{ bar: HTMLDivElement, chevron: HTMLSpanElement, toggleHint: HTMLSpanElement }}
 */
export function createGroupHeaderBar(group, isCollapsed) {
  const bar = document.createElement('div');
  bar.className = 'group-header-bar';

  const left = document.createElement('div');
  left.className = 'group-header-left';

  const chevron = document.createElement('span');
  chevron.className = 'group-chevron' + (isCollapsed ? ' collapsed' : '');
  chevron.textContent = '▼';
  left.appendChild(chevron);

  const folderBadge = document.createElement('span');
  folderBadge.className = 'playlist-folder-badge group-badge';
  folderBadge.textContent = (group.isRoot ? '📥 ' : '📁 ') + group.label;
  left.appendChild(folderBadge);

  const countPill = document.createElement('span');
  countPill.className = 'group-meta-pill';
  countPill.textContent = `${group.files.length} lagu • ${group.totalSizeMb} MB`;
  left.appendChild(countPill);

  const fmtParts = [];
  if (group.mp3Count > 0) fmtParts.push(`${group.mp3Count} MP3`);
  if (group.otherCount > 0) fmtParts.push(`${group.otherCount} Native`);
  if (fmtParts.length > 0) {
    const fmtPill = document.createElement('span');
    fmtPill.className = 'group-meta-pill subtle';
    fmtPill.textContent = fmtParts.join(' • ');
    left.appendChild(fmtPill);
  }

  const right = document.createElement('div');
  right.className = 'group-header-right';

  const toggleHint = document.createElement('span');
  toggleHint.className = 'group-toggle-hint';
  toggleHint.textContent = isCollapsed ? 'Buka Daftar' : 'Lipat';
  right.appendChild(toggleHint);

  bar.appendChild(left);
  bar.appendChild(right);

  return { bar, chevron, toggleHint };
}

/**
 * Creates a compact table cell (<td>) displaying a track index and file name (with optional folder badge).
 * @param {{ name: string, folder?: string }} fileObj
 * @param {{ index?: number, showFolderBadge?: boolean }} opts
 * @returns {HTMLTableCellElement}
 */
export function createFileNameCell(fileObj, opts = {}) {
  const tdName = document.createElement('td');
  tdName.className = 'file-name-cell';

  const showFolder = Boolean(opts.showFolderBadge && fileObj.folder);
  const wrapper = document.createElement('div');
  wrapper.className = showFolder ? 'file-name-wrapper' : 'file-name-inline';

  if (showFolder) {
    const folderBadge = document.createElement('span');
    folderBadge.className = 'playlist-folder-badge';
    folderBadge.textContent = '📁 ' + fileObj.folder;
    folderBadge.title = 'Playlist: ' + fileObj.folder;
    wrapper.appendChild(folderBadge);
  }

  if (typeof opts.index === 'number') {
    const idxSpan = document.createElement('span');
    idxSpan.className = 'track-index-badge';
    idxSpan.textContent = String(opts.index).padStart(2, '0');
    wrapper.appendChild(idxSpan);
  }

  const titleSpan = document.createElement('span');
  titleSpan.className = 'file-title-text';
  titleSpan.textContent = fileObj.name;
  titleSpan.title = fileObj.name;
  wrapper.appendChild(titleSpan);

  tdName.appendChild(wrapper);
  return tdName;
}

/**
 * Fetches /api/system and updates system status indicators across pages.
 * @param {{
 *   pythonVal?: HTMLElement | null,
 *   ytdlpDot?: HTMLElement | null,
 *   ytdlpVal?: HTMLElement | null,
 *   ffmpegDot?: HTMLElement | null,
 *   ffmpegVal?: HTMLElement | null,
 *   ffmpegReadyLabel?: string,
 *   requireFfprobe?: boolean,
 *   cookiesDot?: HTMLElement | null,
 *   cookiesVal?: HTMLElement | null,
 *   onData?: (data: any) => void,
 *   onError?: (err: Error) => void
 * }} opts
 */
export async function checkSystemStatus(opts = {}) {
  try {
    const res = await fetch('/api/system');
    if (!res.ok) return;
    const data = await res.json();

    if (opts.pythonVal) {
      opts.pythonVal.textContent = data.python || '3.12';
    }

    if (opts.ytdlpDot && opts.ytdlpVal) {
      if (data.yt_dlp) {
        opts.ytdlpDot.className = 'status-indicator active';
        opts.ytdlpVal.textContent = 'Installed';
      } else {
        opts.ytdlpDot.className = 'status-indicator error';
        opts.ytdlpVal.textContent = 'Missing';
      }
    }

    if (opts.ffmpegDot && opts.ffmpegVal) {
      const ffmpegOk = opts.requireFfprobe ? Boolean(data.ffmpeg && data.ffprobe) : Boolean(data.ffmpeg);
      if (ffmpegOk) {
        opts.ffmpegDot.className = 'status-indicator active';
        opts.ffmpegVal.textContent = opts.ffmpegReadyLabel || 'Installed';
      } else {
        opts.ffmpegDot.className = 'status-indicator error';
        opts.ffmpegVal.textContent = 'Missing';
      }
    }

    if (opts.cookiesDot && opts.cookiesVal) {
      if (data.cookies_present) {
        opts.cookiesDot.className = 'status-indicator active';
        opts.cookiesVal.textContent = 'cookies.txt';
      } else {
        opts.cookiesDot.className = 'status-indicator';
        opts.cookiesVal.textContent = 'Browser';
      }
    }

    if (typeof opts.onData === 'function') {
      opts.onData(data);
    }
  } catch (err) {
    if (typeof opts.onError === 'function') {
      opts.onError(err);
    }
  }
}

function getSeenTaskIds() {
  try {
    const raw = sessionStorage.getItem(NOTIF_SEEN_TASKS_KEY);
    if (raw === null) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch (_) {
    return new Set();
  }
}

function saveSeenTaskIds(setObj) {
  try {
    const arr = Array.from(setObj).slice(-60);
    sessionStorage.setItem(NOTIF_SEEN_TASKS_KEY, JSON.stringify(arr));
  } catch (_) {
    // Ignore storage errors
  }
}

function mapTaskOutcomeToNotifType(outcome, status) {
  if (outcome === 'ALREADY_EXISTS') return 'exists';
  if (outcome === 'PARTIAL' || outcome === 'WARNING') return 'warning';
  if (outcome === 'FAILED' || status === 'FAILED') return 'error';
  return 'success';
}

/**
 * Creates a reusable queue state poller for /api/queue with automatic per-task notifications.
 * @param {{
 *   queueCounter?: HTMLElement | null,
 *   jobStatusTag?: HTMLElement | null,
 *   jobUrlLabel?: HTMLElement | null,
 *   progressFill?: HTMLElement | null,
 *   progressText?: HTMLElement | null,
 *   terminalLogs?: HTMLElement | null,
 *   onActive?: (current: any, data: any) => void,
 *   onTaskFinished?: (task: any, data: any) => void,
 *   onIdle?: (wasJobRunning: boolean, data: any) => void
 * }} opts
 */
export function createQueueMonitor(opts = {}) {
  let wasJobRunning = false;
  let lastNotifiedTask = null;

  async function poll() {
    try {
      const res = await fetch('/api/queue');
      if (!res.ok) return;
      const data = await res.json();

      const historyList = Array.isArray(data.history) ? data.history : [];
      let seenSet = getSeenTaskIds();
      if (seenSet === null) {
        // First poll in this browser session: seed existing history IDs without firing old toasts
        seenSet = new Set(historyList.map(t => t && t.id).filter(Boolean));
        saveSeenTaskIds(seenSet);
      } else {
        // Check from oldest to newest among unseen history entries
        const unseenTasks = historyList.filter(t => t && t.id && !seenSet.has(t.id)).reverse();
        if (unseenTasks.length > 0) {
          unseenTasks.forEach(task => {
            seenSet.add(task.id);
            lastNotifiedTask = task;
            const notifType = mapTaskOutcomeToNotifType(task.outcome, task.status);
            const fallbackTitle = task.type === 'resample'
              ? (task.status === 'FAILED' ? 'Konversi Gagal' : 'Konversi Selesai')
              : (task.status === 'FAILED' ? 'Unduhan Gagal' : 'Unduhan Selesai');
            const fallbackSummary = task.error || task.url || 'Tugas selesai diproses.';

            notify({
              type: notifType,
              title: task.title || fallbackTitle,
              message: task.summary || fallbackSummary,
              playSound: true,
            });

            if (typeof opts.onTaskFinished === 'function') {
              opts.onTaskFinished(task, data);
            }
          });
          saveSeenTaskIds(seenSet);
        }
      }

      const queueLen = (data.queue || []).length;
      if (opts.queueCounter) {
        opts.queueCounter.textContent = 'Antrian: ' + queueLen;
      }

      const current = data.current;
      if (current) {
        wasJobRunning = true;
        if (opts.jobStatusTag) {
          opts.jobStatusTag.textContent = current.status || 'PROCESSING';
          opts.jobStatusTag.className = 'job-status-tag active';
        }
        if (opts.jobUrlLabel) {
          opts.jobUrlLabel.textContent = current.url;
        }

        const p = Math.round(current.progress || 0);
        if (opts.progressFill) {
          opts.progressFill.style.width = p + '%';
        }
        if (opts.progressText) {
          opts.progressText.textContent = p + '% Complete';
        }

        if (opts.terminalLogs && Array.isArray(current.logs) && current.logs.length > 0) {
          renderLogs(opts.terminalLogs, current.logs);
        }

        if (typeof opts.onActive === 'function') {
          opts.onActive(current, data);
        }
      } else {
        const recentTask = lastNotifiedTask || historyList[0] || null;
        if (opts.jobStatusTag) {
          if (recentTask && lastNotifiedTask) {
            const out = recentTask.outcome || recentTask.status;
            if (out === 'ALREADY_EXISTS') {
              opts.jobStatusTag.textContent = 'SUDAH ADA';
              opts.jobStatusTag.className = 'job-status-tag exists';
            } else if (out === 'FAILED' || recentTask.status === 'FAILED') {
              opts.jobStatusTag.textContent = 'GAGAL';
              opts.jobStatusTag.className = 'job-status-tag error';
            } else if (out === 'WARNING' || out === 'PARTIAL') {
              opts.jobStatusTag.textContent = 'SELESAI (CATATAN)';
              opts.jobStatusTag.className = 'job-status-tag active';
            } else {
              opts.jobStatusTag.textContent = 'SELESAI';
              opts.jobStatusTag.className = 'job-status-tag success';
            }
          } else {
            opts.jobStatusTag.textContent = 'IDLE';
            opts.jobStatusTag.className = 'job-status-tag';
          }
        }
        if (opts.jobUrlLabel && lastNotifiedTask && lastNotifiedTask.summary) {
          opts.jobUrlLabel.textContent = lastNotifiedTask.summary;
        }
        if (queueLen === 0) {
          const justFinished = wasJobRunning;
          wasJobRunning = false;
          if (typeof opts.onIdle === 'function') {
            opts.onIdle(justFinished, data);
          }
        }
      }
    } catch (err) {
      // Ignore transient background poll errors
    }
  }

  return { poll };
}
