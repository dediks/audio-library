/**
 * Audio Lab - Shared UI Facade & App Header / System Status Module
 * Strict DOM Manipulation (No innerHTML, strictly textContent, createElement & createElementNS)
 */

import { createSvgIcon, createExplorerIcon, createEditIcon, createTrashIcon } from './dom-icons.js';
import { apiGet, apiPost } from './api-client.js';
import {
  notify,
  playNotificationSound,
  createHeaderNotificationCenter,
} from './notifications.js';
import {
  groupFiles,
  groupFilesByFolder,
  createGroupHeaderBar,
  createFileNameCell,
  createGroupCollapseController,
} from './table-groups.js';
import { renderLogs, setLogFilter, createQueueMonitor } from './queue-monitor.js';
import { openRenameModal, openDeleteModal, openBatchRenameModal } from './rename-modal.js';
import { spaNavigate, initSpaRouter } from './spa-router.js';
import { initPersistentDock, ensureFohAudioElement } from './persistent-dock.js';

// Safe DOMContentLoaded hook for dynamically loaded SPA modules
if (typeof document !== 'undefined') {
  const nativeAddEventListener = EventTarget.prototype.addEventListener;
  document.addEventListener = function (type, listener, options) {
    if (type === 'DOMContentLoaded' && document.readyState !== 'loading') {
      queueMicrotask(() => {
        try {
          if (typeof listener === 'function') {
            listener.call(document, new Event('DOMContentLoaded'));
          } else if (listener && typeof listener.handleEvent === 'function') {
            listener.handleEvent(new Event('DOMContentLoaded'));
          }
        } catch (err) {
          console.error('[SPA Shell] Error in DOMContentLoaded callback:', err);
        }
      });
      return;
    }
    return nativeAddEventListener.call(document, type, listener, options);
  };
}

export {
  createSvgIcon,
  createExplorerIcon,
  createEditIcon,
  createTrashIcon,
  apiGet,
  apiPost,
  notify,
  playNotificationSound,
  groupFiles,
  groupFilesByFolder,
  createGroupHeaderBar,
  createFileNameCell,
  createGroupCollapseController,
  renderLogs,
  setLogFilter,
  createQueueMonitor,
  openRenameModal,
  openDeleteModal,
  openBatchRenameModal,
  spaNavigate,
  initSpaRouter,
  initPersistentDock,
  ensureFohAudioElement,
};

/**
 * Creates a compact Spectral Quality Badge element when spectral_status is available.
 * @param {Record<string, any> | null | undefined} qc
 * @returns {HTMLSpanElement | null}
 */
export function createSpectralBadge(qc) {
  if (!qc || !qc.spectral_status || qc.spectral_status === 'UNKNOWN') {
    return null;
  }
  const span = document.createElement('span');
  const status = String(qc.spectral_status).toUpperCase();
  const rawLabel = String(qc.spectral_label || '')
    .replace(/Asli\s*\(Full HQ\)/gi, 'Full-Range')
    .replace(/\bAsli\b/gi, 'Full-Range')
    .replace(/\(Standar\)/gi, 'Standard')
    .replace(/\bSpektrum\b/gi, 'Spectrum');

  if (status === 'AUTHENTIC') {
    span.className = 'spectral-badge authentic';
    span.textContent = rawLabel || '20 kHz Full-Range';
    span.title = 'Full-Range High-Frequency Spectrum (~20 kHz Authentic Lossless / HQ).';
  } else if (status === 'FAKE_HQ') {
    span.className = 'spectral-badge fake';
    span.textContent = rawLabel || '⚠️ Fake HQ';
    span.title = 'High-frequency spectral cutoff detected (<16 kHz) despite high bitrate — indicates upsampled/transcoded lossy source.';
  } else if (status === 'STANDARD') {
    span.className = 'spectral-badge standard';
    span.textContent = rawLabel || '16 kHz Standard';
    span.title = 'Standard high-frequency spectrum bandwidth (~16 kHz).';
  } else {
    span.className = 'spectral-badge low';
    span.textContent = rawLabel || '<14 kHz Low-BW';
    span.title = 'Limited high-frequency bandwidth (<14 kHz).';
  }
  return span;
}

const WORKSPACE_STORAGE_KEY = 'swararia_workspace_state_v1';

/**
 * Reads shared workspace selection and source directory from sessionStorage.
 * @returns {{ sourceDir: string, activePlaylist: string, selectedPaths: string[], activeTrackRelPath: string }}
 */
export function getSharedWorkspaceState() {
  try {
    const raw = sessionStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return { sourceDir: '', activePlaylist: 'ALL', selectedPaths: [], activeTrackRelPath: '' };
    const parsed = JSON.parse(raw);
    return {
      sourceDir: typeof parsed.sourceDir === 'string' ? parsed.sourceDir : '',
      activePlaylist: typeof parsed.activePlaylist === 'string' ? parsed.activePlaylist : 'ALL',
      selectedPaths: Array.isArray(parsed.selectedPaths) ? parsed.selectedPaths : [],
      activeTrackRelPath: typeof parsed.activeTrackRelPath === 'string' ? parsed.activeTrackRelPath : '',
    };
  } catch (_e) {
    return { sourceDir: '', activePlaylist: 'ALL', selectedPaths: [], activeTrackRelPath: '' };
  }
}

/**
 * Persists partial workspace state (sourceDir, activePlaylist, selectedPaths, activeTrackRelPath) to sessionStorage.
 * @param {{ sourceDir?: string, activePlaylist?: string, selectedPaths?: string[] | Set<string>, activeTrackRelPath?: string }} partial
 */
export function saveSharedWorkspaceState(partial = {}) {
  try {
    const prev = getSharedWorkspaceState();
    const next = {
      sourceDir: partial.sourceDir !== undefined ? String(partial.sourceDir || '') : prev.sourceDir,
      activePlaylist: partial.activePlaylist !== undefined ? String(partial.activePlaylist || 'ALL') : prev.activePlaylist,
      selectedPaths:
        partial.selectedPaths !== undefined
          ? Array.from(partial.selectedPaths)
          : prev.selectedPaths,
      activeTrackRelPath:
        partial.activeTrackRelPath !== undefined
          ? String(partial.activeTrackRelPath || '')
          : prev.activeTrackRelPath,
    };
    sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(next));
  } catch (_e) {
    // Ignore storage quota errors
  }
}

/**
 * Shared Top Header & Navigation Component.
 * Mounts identical Brand, 4-Stage Workflow Navigation Tabs, and System Diagnostics Bar across all pages,
 * and automatically fetches /api/system to update the status pills.
 *
 * @param {{
 *   activePage?: 'ingest' | 'qc' | 'converter' | 'organizer',
 *   onSystemData?: (data: any) => void,
 *   onSystemError?: (err: Error) => void
 * }} opts
 */
export function initAppHeader(opts = {}) {
  const headerEl = document.getElementById('appHeader') || document.querySelector('.app-header');
  if (!headerEl) return {};

  const activePage = opts.activePage || headerEl.dataset.page || 'ingest';
  if (typeof document !== 'undefined' && document.body) {
    document.body.dataset.page = activePage;
  }
  headerEl.replaceChildren();

  // 1. Brand Block
  const brand = document.createElement('div');
  brand.className = 'brand';

  const brandIcon = document.createElement('div');
  brandIcon.className = 'brand-icon';
  const brandLogoImg = document.createElement('img');
  brandLogoImg.src = '/static/swararia-logo.jpg';
  brandLogoImg.alt = 'SWARARIA AUDIO LAB';
  brandLogoImg.className = 'brand-logo-img';
  brandIcon.appendChild(brandLogoImg);

  const brandInfo = document.createElement('div');
  brandInfo.className = 'brand-info';

  const brandTitle = document.createElement('h1');
  brandTitle.className = 'brand-title';
  brandTitle.appendChild(document.createTextNode('SWARARIA AUDIO LAB '));
  const studioBadge = document.createElement('span');
  studioBadge.className = 'badge-studio';
  studioBadge.textContent = 'PRO FOH';
  brandTitle.appendChild(studioBadge);

  const brandSubtitle = document.createElement('p');
  brandSubtitle.className = 'brand-subtitle';
  brandSubtitle.textContent = 'Pro Audio & Video Production Suite';

  brandInfo.appendChild(brandTitle);
  brandInfo.appendChild(brandSubtitle);
  brand.appendChild(brandIcon);
  brand.appendChild(brandInfo);

  // 2. 7-Stage Pipeline Navigation Tabs
  const nav = document.createElement('nav');
  nav.className = 'app-nav';
  nav.setAttribute('aria-label', 'Main Navigation');

  function makeNavTab(href, pageKey, labelText, iconShapes) {
    const a = document.createElement('a');
    a.href = href;
    a.className = 'nav-tab' + (activePage === pageKey ? ' active' : '');
    a.appendChild(createSvgIcon(iconShapes));
    const span = document.createElement('span');
    span.textContent = labelText;
    a.appendChild(span);
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      spaNavigate(href);
    });
    return a;
  }

  const tabIngest = makeNavTab('/', 'ingest', '1. Ingest', [
    { tag: 'path', attrs: { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' } },
    { tag: 'polyline', attrs: { points: '7 10 12 15 17 10' } },
    { tag: 'line', attrs: { x1: '12', y1: '15', x2: '12', y2: '3' } },
  ]);

  const tabQc = makeNavTab('/qc', 'qc', '2. QC Lab', [
    { tag: 'path', attrs: { d: 'M2 10v3' } },
    { tag: 'path', attrs: { d: 'M6 6v11' } },
    { tag: 'path', attrs: { d: 'M10 3v18' } },
    { tag: 'path', attrs: { d: 'M14 8v7' } },
    { tag: 'path', attrs: { d: 'M18 5v13' } },
    { tag: 'path', attrs: { d: 'M22 10v3' } },
  ]);

  const tabConverter = makeNavTab('/converter', 'converter', '3. Converter', [
    { tag: 'polyline', attrs: { points: '17 1 21 5 17 9' } },
    { tag: 'path', attrs: { d: 'M3 11V9a4 4 0 0 1 4-4h14' } },
    { tag: 'polyline', attrs: { points: '7 23 3 19 7 15' } },
    { tag: 'path', attrs: { d: 'M21 13v2a4 4 0 0 1-4 4H3' } },
  ]);

  const tabOrganizer = makeNavTab('/organizer', 'organizer', '4. Organizer', [
    { tag: 'line', attrs: { x1: '8', y1: '6', x2: '21', y2: '6' } },
    { tag: 'line', attrs: { x1: '8', y1: '12', x2: '21', y2: '12' } },
    { tag: 'line', attrs: { x1: '8', y1: '18', x2: '21', y2: '18' } },
    { tag: 'line', attrs: { x1: '3', y1: '6', x2: '3.01', y2: '6' } },
    { tag: 'line', attrs: { x1: '3', y1: '12', x2: '3.01', y2: '12' } },
    { tag: 'line', attrs: { x1: '3', y1: '18', x2: '3.01', y2: '18' } },
  ]);

  const tabMultitrack = makeNavTab('/multitrack', 'multitrack', '5. Multitrack', [
    { tag: 'line', attrs: { x1: '4', y1: '21', x2: '4', y2: '14' } },
    { tag: 'line', attrs: { x1: '4', y1: '10', x2: '4', y2: '3' } },
    { tag: 'line', attrs: { x1: '12', y1: '21', x2: '12', y2: '12' } },
    { tag: 'line', attrs: { x1: '12', y1: '8', x2: '12', y2: '3' } },
    { tag: 'line', attrs: { x1: '20', y1: '21', x2: '20', y2: '16' } },
    { tag: 'line', attrs: { x1: '20', y1: '12', x2: '20', y2: '3' } },
    { tag: 'circle', attrs: { cx: '4', cy: '12', r: '2' } },
    { tag: 'circle', attrs: { cx: '12', cy: '10', r: '2' } },
    { tag: 'circle', attrs: { cx: '20', cy: '14', r: '2' } },
  ]);

  const tabVideoSplit = makeNavTab('/video-split', 'video-split', '6. Video Split', [
    { tag: 'rect', attrs: { x: '2', y: '2', width: '20', height: '20', rx: '2.18', ry: '2.18' } },
    { tag: 'line', attrs: { x1: '7', y1: '2', x2: '7', y2: '22' } },
    { tag: 'line', attrs: { x1: '17', y1: '2', x2: '17', y2: '22' } },
    { tag: 'line', attrs: { x1: '2', y1: '12', x2: '22', y2: '12' } },
    { tag: 'line', attrs: { x1: '2', y1: '7', x2: '7', y2: '7' } },
    { tag: 'line', attrs: { x1: '2', y1: '17', x2: '7', y2: '17' } },
    { tag: 'line', attrs: { x1: '17', y1: '7', x2: '22', y2: '7' } },
    { tag: 'line', attrs: { x1: '17', y1: '17', x2: '22', y2: '17' } },
  ]);

  const tabPlayer = makeNavTab('/player', 'player', '7. FOH Player', [
    { tag: 'polygon', attrs: { points: '5 3 19 12 5 21 5 3' } },
  ]);

  nav.appendChild(tabIngest);
  nav.appendChild(tabQc);
  nav.appendChild(tabConverter);
  nav.appendChild(tabOrganizer);
  nav.appendChild(tabMultitrack);
  nav.appendChild(tabVideoSplit);
  nav.appendChild(tabPlayer);

  // 3. Compact Header Actions (Version + Notification Center)
  const statusGroup = document.createElement('div');
  statusGroup.className = 'header-actions-group';
  statusGroup.id = 'systemStatusGroup';

  const updateBtn = document.createElement('button');
  updateBtn.type = 'button';
  updateBtn.className = 'header-version-btn';
  updateBtn.id = 'statusUpdate';
  updateBtn.title = 'Swararia Audio Lab — Klik untuk periksa pembaruan';

  const updateDot = document.createElement('span');
  updateDot.className = 'status-indicator active';
  updateDot.id = 'updateDot';

  const updateVal = document.createElement('span');
  updateVal.id = 'updateVal';
  updateVal.textContent = 'v1.0.0';

  updateBtn.appendChild(updateDot);
  updateBtn.appendChild(updateVal);

  updateBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openUpdateModal(true);
  });

  statusGroup.appendChild(updateBtn);

  // 4. Notification Bell & History Popover in Header
  const notifWrapper = createHeaderNotificationCenter();
  statusGroup.appendChild(notifWrapper);

  headerEl.appendChild(brand);
  headerEl.appendChild(nav);
  headerEl.appendChild(statusGroup);

  function refreshStatus() {
    return checkSystemStatus({
      updateVal: updateVal,
      onData: (data) => {
        if (data.app_version) {
          updateVal.textContent = 'v' + data.app_version;
        }
        if (typeof opts.onSystemData === 'function') {
          opts.onSystemData(data);
        }
      },
      onError: opts.onSystemError,
    });
  }

  refreshStatus();
  initSpaRouter();

  // Background check for GitHub updates shortly after startup
  setTimeout(() => {
    checkForUpdatesUI({ val: updateVal, dot: updateDot, pill: updateBtn }, false);
  }, 2500);

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

  if (opts.updateVal && data.app_version) {
    opts.updateVal.textContent = 'v' + data.app_version;
  }

  if (typeof opts.onData === 'function') {
    opts.onData(data);
  }
}

/**
 * Sends a request to open a folder in Windows File Explorer (or host file manager).
 * @param {string} [folderPath] - Relative subfolder or full path.
 * @param {string} [sourceDir] - Base source directory.
 * @returns {Promise<boolean>}
 */
export async function openFolderInExplorer(folderPath = '', sourceDir = '') {
  notify({
    type: 'info',
    title: 'Membuka File Explorer...',
    message: 'Mengirim perintah buka direktori ke Windows Explorer...',
    duration: 2500,
  });

  const { ok, data, error } = await apiPost('/api/open-folder', {
    source_dir: sourceDir || '',
    folder: folderPath || '',
  });

  if (ok) {
    notify({
      type: 'success',
      title: 'Windows Explorer Dibuka',
      message: data?.message || 'Folder berhasil dibuka di File Explorer.',
      duration: 3800,
    });
    return true;
  } else {
    notify({
      type: 'error',
      title: 'Gagal Membuka Explorer',
      message: error || 'Gagal membuka folder di Windows Explorer.',
      duration: 5000,
      playSound: true,
    });
    return false;
  }
}

// ==============================================================================
// GITHUB RELEASE UPDATE CHECKER & IN-APP AUTO-INSTALLER
// ==============================================================================

let cachedUpdateData = null;
let isCheckingUpdate = false;

/**
 * Checks for software updates from GitHub Releases API and updates header status pill.
 * @param {{ val?: HTMLElement, dot?: HTMLElement, pill?: HTMLElement } | null} updatePill
 * @param {boolean} [isManual=false]
 * @returns {Promise<any>}
 */
export async function checkForUpdatesUI(updatePill, isManual = false) {
  if (isCheckingUpdate) return cachedUpdateData;
  isCheckingUpdate = true;
  if (updatePill && isManual && updatePill.val) {
    updatePill.val.textContent = 'checking...';
  }

  try {
    const { ok, data } = await apiGet('/api/check-update');
    isCheckingUpdate = false;
    if (ok && data) {
      cachedUpdateData = data;
      if (updatePill) {
        if (data.has_update) {
          if (updatePill.val) updatePill.val.textContent = (data.latest_version || 'new') + ' ⚡';
          if (updatePill.dot) updatePill.dot.className = 'status-indicator update-available';
          if (updatePill.pill) {
            updatePill.pill.classList.add('has-update');
            updatePill.pill.title = 'Versi baru ' + data.latest_version + ' tersedia! Klik untuk perbarui.';
          }
          if (!isManual) {
            notify({
              type: 'info',
              title: 'Pembaruan Tersedia',
              message: 'Swararia Audio Lab ' + data.latest_version + ' telah dirilis. Klik badge versi untuk detail.',
              duration: 8000,
            });
          }
        } else {
          if (updatePill.val) updatePill.val.textContent = 'v' + (data.current_version || '1.0.0');
          if (updatePill.dot) updatePill.dot.className = 'status-indicator active';
          if (updatePill.pill) {
            updatePill.pill.classList.remove('has-update');
            updatePill.pill.title = 'Swararia Audio Lab v' + (data.current_version || '1.0.0') + ' (Versi Terbaru)';
          }
        }
      }
      return data;
    }
  } catch (err) {
    isCheckingUpdate = false;
    console.error('[Update Checker] Gagal memeriksa update:', err);
  }
  return null;
}

/**
 * Opens the release update modal dialog with changelog and 1-click installer.
 * @param {boolean} [isManual=true]
 */
export function openUpdateModal(isManual = true) {
  const existing = document.getElementById('updateModalBackdrop');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'updateModalBackdrop';

  const card = document.createElement('div');
  card.className = 'modal-card modal-update-card';

  // 1. Header
  const header = document.createElement('div');
  header.className = 'modal-header';

  const h3 = document.createElement('h3');
  h3.textContent = 'Pembaruan Swararia Audio Lab';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close-btn';
  closeBtn.title = 'Tutup';
  closeBtn.appendChild(createSvgIcon([
    { tag: 'line', attrs: { x1: '18', y1: '6', x2: '6', y2: '18' } },
    { tag: 'line', attrs: { x1: '6', y1: '6', x2: '18', y2: '18' } },
  ]));
  closeBtn.addEventListener('click', () => backdrop.remove());

  header.appendChild(h3);
  header.appendChild(closeBtn);

  // 2. Body
  const body = document.createElement('div');
  body.className = 'modal-body';

  const loadingWrap = document.createElement('div');
  loadingWrap.className = 'update-loading-wrap';
  loadingWrap.textContent = 'Memeriksa rilis terbaru dari GitHub dediks/audio-library...';
  body.appendChild(loadingWrap);

  // 3. Footer
  const footer = document.createElement('div');
  footer.className = 'modal-footer';

  const btnClose = document.createElement('button');
  btnClose.type = 'button';
  btnClose.className = 'btn-modal-cancel';
  btnClose.textContent = 'Tutup';
  btnClose.addEventListener('click', () => backdrop.remove());
  footer.appendChild(btnClose);

  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(footer);
  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      backdrop.remove();
      window.removeEventListener('keydown', onKeyDown);
    }
  };
  window.addEventListener('keydown', onKeyDown);

  const renderData = (data) => {
    body.replaceChildren();

    if (!data || !data.ok) {
      const banner = document.createElement('div');
      banner.className = 'update-banner-card error';

      const title = document.createElement('h4');
      title.className = 'update-banner-title';
      title.textContent = '⚠️ Tidak Dapat Memeriksa Rilis';

      const desc = document.createElement('p');
      desc.className = 'update-banner-sub';
      desc.textContent = (data && data.error) ? data.error : 'Pastikan komputer terhubung ke internet atau periksa repositori GitHub.';

      banner.appendChild(title);
      banner.appendChild(desc);
      body.appendChild(banner);

      const actions = document.createElement('div');
      actions.className = 'update-actions-bar';

      const ghLink = document.createElement('a');
      ghLink.className = 'btn-update-secondary';
      ghLink.href = (data && data.html_url) || 'https://github.com/dediks/audio-library';
      ghLink.target = '_blank';
      ghLink.rel = 'noopener noreferrer';
      ghLink.textContent = '🌐 Buka Repository GitHub';
      actions.appendChild(ghLink);

      body.appendChild(actions);
      return;
    }

    if (data.has_update) {
      const banner = document.createElement('div');
      banner.className = 'update-banner-card has-update';

      const title = document.createElement('h4');
      title.className = 'update-banner-title';
      title.textContent = '⚡ Versi Baru Tersedia: ' + data.latest_version;

      const sub = document.createElement('p');
      sub.className = 'update-banner-sub';
      const pubDate = data.published_at ? data.published_at.substring(0, 10) : '';
      sub.textContent = 'Versi Anda saat ini: v' + data.current_version + (pubDate ? ' • Dirilis pada: ' + pubDate : '');

      banner.appendChild(title);
      banner.appendChild(sub);
      body.appendChild(banner);

      if (data.release_name && data.release_name !== data.latest_version) {
        const relName = document.createElement('div');
        relName.className = 'update-section-title';
        relName.textContent = data.release_name;
        body.appendChild(relName);
      }

      const notesTitle = document.createElement('div');
      notesTitle.className = 'update-section-title';
      notesTitle.textContent = 'Catatan Rilis (Changelog):';
      body.appendChild(notesTitle);

      const changelog = document.createElement('pre');
      changelog.className = 'update-changelog';
      changelog.textContent = data.release_notes || 'Tidak ada catatan rilis tertulis.';
      body.appendChild(changelog);

      const actions = document.createElement('div');
      actions.className = 'update-actions-bar';

      if (data.download_url) {
        const btnInstall = document.createElement('button');
        btnInstall.type = 'button';
        btnInstall.className = 'btn-update-primary';
        btnInstall.textContent = '⚡ Unduh & Pasang Pembaruan';
        btnInstall.addEventListener('click', async () => {
          btnInstall.disabled = true;
          btnInstall.textContent = 'Mengunduh... Mohon tunggu (aplikasi akan restart)';
          try {
            const res = await apiPost('/api/install-update', { download_url: data.download_url });
            if (res.ok) {
              btnInstall.textContent = 'Installer sedang dibuka... Menutup aplikasi.';
            } else {
              btnInstall.disabled = false;
              btnInstall.textContent = 'Gagal memasang: ' + (res.data?.message || res.error || 'Unknown error');
            }
          } catch (err) {
            btnInstall.disabled = false;
            btnInstall.textContent = 'Gagal: ' + err.message;
          }
        });
        actions.appendChild(btnInstall);
      }

      const ghLink = document.createElement('a');
      ghLink.className = 'btn-update-secondary';
      ghLink.href = data.html_url || 'https://github.com/dediks/audio-library/releases';
      ghLink.target = '_blank';
      ghLink.rel = 'noopener noreferrer';
      ghLink.textContent = '🌐 Buka Rilis di GitHub';
      actions.appendChild(ghLink);

      body.appendChild(actions);
    } else {
      const banner = document.createElement('div');
      banner.className = 'update-banner-card up-to-date';

      const title = document.createElement('h4');
      title.className = 'update-banner-title';
      title.textContent = '✅ Anda Menggunakan Versi Terbaru (v' + data.current_version + ')';

      const sub = document.createElement('p');
      sub.className = 'update-banner-sub';
      sub.textContent = data.message || 'Sistem telah memeriksa rilis resmi terbaru di GitHub dediks/audio-library.';

      banner.appendChild(title);
      banner.appendChild(sub);
      body.appendChild(banner);

      const actions = document.createElement('div');
      actions.className = 'update-actions-bar';

      const ghLink = document.createElement('a');
      ghLink.className = 'btn-update-secondary';
      ghLink.href = data.html_url || 'https://github.com/dediks/audio-library';
      ghLink.target = '_blank';
      ghLink.rel = 'noopener noreferrer';
      ghLink.textContent = '🌐 Kunjungi Repository GitHub';
      actions.appendChild(ghLink);

      body.appendChild(actions);
    }
  };

  const pill = document.getElementById('statusUpdate');
  checkForUpdatesUI(pill ? { val: document.getElementById('updateVal'), dot: document.getElementById('updateDot'), pill } : null, true)
    .then((data) => {
      renderData(data);
    })
    .catch((err) => {
      renderData({ ok: false, error: String(err) });
    });
}
