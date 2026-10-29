/**
 * Audio Lab - Shared UI Facade & App Header / System Status Module
 * Strict DOM Manipulation (No innerHTML, strictly textContent, createElement & createElementNS)
 */

import { createSvgIcon } from './dom-icons.js';
import { apiGet, apiPost } from './api-client.js';
import {
  notify,
  playNotificationSound,
  createHeaderNotificationCenter,
} from './notifications.js';
import {
  groupFilesByFolder,
  createGroupHeaderBar,
  createFileNameCell,
  createGroupCollapseController,
} from './table-groups.js';
import { renderLogs, createQueueMonitor } from './queue-monitor.js';

export {
  createSvgIcon,
  apiGet,
  apiPost,
  notify,
  playNotificationSound,
  groupFilesByFolder,
  createGroupHeaderBar,
  createFileNameCell,
  createGroupCollapseController,
  renderLogs,
  createQueueMonitor,
};

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
  const { ok, data, error } = await apiGet('/api/system');
  if (!ok) {
    if (error && typeof opts.onError === 'function') {
      opts.onError(new Error(error));
    }
    return;
  }

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
}
