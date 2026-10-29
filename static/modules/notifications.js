/**
 * Audio Lab - Notification Engine (Toast Stack + Header History Center + Studio Chime)
 * Strict DOM Manipulation (No innerHTML, strictly textContent, createElement & createElementNS)
 */

import { createSvgIcon } from './dom-icons.js';

const NOTIF_HISTORY_KEY = 'audio_lab_notif_history';
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
      playTone(523.25, 0.0, 0.14, 'sine', 0.05);
      playTone(659.25, 0.09, 0.16, 'sine', 0.05);
      playTone(783.99, 0.18, 0.24, 'sine', 0.055);
    } else if (type === 'exists') {
      playTone(440.0, 0.0, 0.11, 'triangle', 0.045);
      playTone(523.25, 0.12, 0.16, 'triangle', 0.045);
    } else if (type === 'warning') {
      playTone(392.0, 0.0, 0.15, 'triangle', 0.055);
      playTone(329.63, 0.14, 0.22, 'triangle', 0.055);
    } else if (type === 'error') {
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

export function createHeaderNotificationCenter() {
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

