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

/**
 * Creates a reusable queue state poller for /api/queue.
 * @param {{
 *   queueCounter?: HTMLElement | null,
 *   jobStatusTag?: HTMLElement | null,
 *   jobUrlLabel?: HTMLElement | null,
 *   progressFill?: HTMLElement | null,
 *   progressText?: HTMLElement | null,
 *   terminalLogs?: HTMLElement | null,
 *   onActive?: (current: any, data: any) => void,
 *   onIdle?: (wasJobRunning: boolean, data: any) => void
 * }} opts
 */
export function createQueueMonitor(opts = {}) {
  let wasJobRunning = false;

  async function poll() {
    try {
      const res = await fetch('/api/queue');
      if (!res.ok) return;
      const data = await res.json();

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
        if (opts.jobStatusTag) {
          opts.jobStatusTag.textContent = 'IDLE';
          opts.jobStatusTag.className = 'job-status-tag';
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
