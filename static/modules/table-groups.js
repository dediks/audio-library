/**
 * Audio Lab - Shared Table Grouping & Collapsible Row Components
 * Supports grouping by Folder, File Type (.opus/.webm/.mp3/.m4a), Folder + Type, and Sample Rate.
 * Strict DOM Manipulation (No innerHTML, strictly textContent & createElement)
 */

import { createExplorerIcon, createEditIcon, createTrashIcon } from './dom-icons.js';

const EXT_DESCRIPTIONS = {
  '.opus': 'OPUS Audio (.opus)',
  '.webm': 'WebM Audio Container (.webm)',
  '.mp3': 'MP3 Audio (.mp3)',
  '.m4a': 'AAC / M4A Audio (.m4a)',
  '.ogg': 'OGG Vorbis / Opus (.ogg)',
  '.wav': 'WAV PCM Lossless (.wav)',
  '.flac': 'FLAC Lossless (.flac)',
};

/**
 * Computes a concise extension breakdown string (e.g. "8 .mp3 • 4 .opus").
 * @param {Array<any>} files
 * @returns {string}
 */
function buildExtBreakdown(files) {
  const counts = new Map();
  files.forEach(f => {
    const ext = (f.ext || '').toLowerCase() || 'lainnya';
    counts.set(ext, (counts.get(ext) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([ext, cnt]) => `${cnt} ${ext}`)
    .join(' • ');
}

/**
 * Groups an array of file objects by the specified mode:
 * - 'folder': Group by playlist folder (default)
 * - 'type': Group by file extension/format (.opus, .webm, .mp3, .m4a, etc.)
 * - 'folder_type': Group by Folder + File extension (ideal for cleaning up duplicate formats in a folder)
 * - 'rate': Group by Sample Rate (48000 Hz, 44100 Hz, Belum Dipindai)
 *
 * @param {Array<any>} files
 * @param {'folder' | 'type' | 'folder_type' | 'rate'} [mode='folder']
 */
export function groupFiles(files, mode = 'folder') {
  const map = new Map();

  files.forEach(f => {
    const folder = f.folder || '';
    const ext = (f.ext || '').toLowerCase();
    const extUpper = ext.replace('.', '').toUpperCase() || 'AUDIO';
    let key = '';
    let label = '';
    let isRoot = false;
    let folderLabel = folder || 'Root (Inbox)';
    let extLabel = EXT_DESCRIPTIONS[ext] || `Format ${extUpper} (${ext})`;

    if (mode === 'type') {
      key = `type::${ext || 'unknown'}`;
      label = extLabel;
    } else if (mode === 'folder_type') {
      key = `ft::${folder || '__ROOT__'}::${ext || 'unknown'}`;
      label = `${folderLabel} — ${extUpper} (${ext})`;
      isRoot = !folder;
    } else if (mode === 'rate') {
      const sr = f.qc && f.qc.sample_rate_hz ? String(f.qc.sample_rate_hz) : '';
      key = `rate::${sr || 'unprobed'}`;
      if (sr === '48000') label = '48.0 kHz (48000 Hz — Standar FOH / Native)';
      else if (sr === '44100') label = '44.1 kHz (44100 Hz — Standar CDJ / USB)';
      else if (sr) label = `Sample Rate ${sr} Hz`;
      else label = 'Sample Rate Belum Dipindai';
    } else {
      key = folder || '__ROOT__';
      label = folder ? folder : 'File di Root (Inbox)';
      isRoot = !folder;
    }

    if (!map.has(key)) {
      map.set(key, {
        key,
        label,
        groupType: mode,
        isRoot,
        folderPath: folder,
        folderLabel,
        ext,
        extLabel,
        files: [],
        totalSizeMb: 0,
        mp3Count: 0,
        otherCount: 0,
      });
    }

    const g = map.get(key);
    g.files.push(f);
    g.totalSizeMb += Number(f.size_mb || 0);
    if (ext === '.mp3') g.mp3Count += 1;
    else g.otherCount += 1;
  });

  const groups = Array.from(map.values());
  groups.forEach(g => {
    g.totalSizeMb = Math.round(g.totalSizeMb * 10) / 10;
    g.extSummary = buildExtBreakdown(g.files);
  });

  if (mode === 'type') {
    const order = ['.opus', '.webm', '.mp3', '.m4a', '.flac', '.wav', '.ogg'];
    groups.sort((a, b) => {
      const ia = order.indexOf(a.ext);
      const ib = order.indexOf(b.ext);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.label.localeCompare(b.label);
    });
  } else if (mode === 'folder_type') {
    groups.sort((a, b) => {
      if (a.folderPath !== b.folderPath) {
        if (!a.folderPath) return -1;
        if (!b.folderPath) return 1;
        return a.folderPath.localeCompare(b.folderPath);
      }
      return a.ext.localeCompare(b.ext);
    });
  }

  return groups;
}

/**
 * Legacy alias for backward compatibility.
 * @param {Array<any>} files
 */
export function groupFilesByFolder(files) {
  return groupFiles(files, 'folder');
}

/**
 * Builds the inner bar of a collapsible group header row.
 */
export function createGroupHeaderBar(group, isCollapsed, opts = {}) {
  const bar = document.createElement('div');
  bar.className = 'group-header-bar';

  const left = document.createElement('div');
  left.className = 'group-header-left';

  const chevron = document.createElement('span');
  chevron.className = 'group-chevron' + (isCollapsed ? ' collapsed' : '');
  chevron.textContent = '▼';
  left.appendChild(chevron);

  const folderBadge = document.createElement('span');
  const gType = group.groupType || 'folder';
  folderBadge.className =
    'playlist-folder-badge group-badge' + (gType !== 'folder' ? ' group-badge-type' : '');

  if (gType === 'type') {
    folderBadge.textContent = '🎵 ' + group.label;
  } else if (gType === 'folder_type') {
    folderBadge.textContent = (group.isRoot ? '📥 ' : '📁 ') + group.label;
  } else if (gType === 'rate') {
    folderBadge.textContent = '🎛️ ' + group.label;
  } else {
    folderBadge.textContent = (group.isRoot ? '📥 ' : '📁 ') + group.label;
  }
  left.appendChild(folderBadge);

  const countPill = document.createElement('span');
  countPill.className = 'group-meta-pill';
  countPill.textContent = `${group.files.length} lagu • ${group.totalSizeMb} MB`;
  left.appendChild(countPill);

  if (group.extSummary) {
    const fmtPill = document.createElement('span');
    fmtPill.className = 'group-meta-pill subtle';
    fmtPill.textContent = group.extSummary;
    left.appendChild(fmtPill);
  }

  const right = document.createElement('div');
  right.className = 'group-header-right';

  // Quick Action: Open in Windows Explorer (for folder and folder_type groups)
  if (typeof opts.onOpenExplorer === 'function' && (gType === 'folder' || gType === 'folder_type')) {
    const btnExplorer = document.createElement('button');
    btnExplorer.type = 'button';
    btnExplorer.className = 'btn-group-action';
    btnExplorer.title = 'Buka folder ini di File Explorer';
    btnExplorer.appendChild(createExplorerIcon());
    const expText = document.createElement('span');
    expText.textContent = 'Explorer';
    btnExplorer.appendChild(expText);
    btnExplorer.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onOpenExplorer(group);
    });
    right.appendChild(btnExplorer);
  }

  // Quick Action: Rename Folder (only when grouped by folder and not root)
  if (typeof opts.onRenameFolder === 'function' && gType === 'folder' && !group.isRoot) {
    const btnRename = document.createElement('button');
    btnRename.type = 'button';
    btnRename.className = 'btn-group-action';
    btnRename.title = 'Ubah nama folder playlist ini';
    btnRename.appendChild(createEditIcon());
    const renText = document.createElement('span');
    renText.textContent = 'Rename';
    btnRename.appendChild(renText);
    btnRename.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onRenameFolder(group);
    });
    right.appendChild(btnRename);
  }

  // Quick Action: Delete Entire Folder (for folder mode) OR Batch Delete Group Files (for type / folder_type / rate modes)
  if (gType === 'folder' && !group.isRoot && typeof opts.onDeleteFolder === 'function') {
    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'btn-group-action btn-group-danger';
    btnDelete.title = 'Hapus folder playlist ini beserta seluruh lagu di dalamnya';
    btnDelete.appendChild(createTrashIcon());
    const delText = document.createElement('span');
    delText.textContent = 'Hapus Folder';
    btnDelete.appendChild(delText);
    btnDelete.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onDeleteFolder(group);
    });
    right.appendChild(btnDelete);
  } else if (typeof opts.onDeleteGroupFiles === 'function' && group.files.length > 0) {
    const btnDeleteGroup = document.createElement('button');
    btnDeleteGroup.type = 'button';
    btnDeleteGroup.className = 'btn-group-action btn-group-danger';
    btnDeleteGroup.title = `Hapus semua ${group.files.length} file di grup "${group.label}"`;
    btnDeleteGroup.appendChild(createTrashIcon());
    const delText = document.createElement('span');
    delText.textContent = `Hapus Grup (${group.files.length})`;
    btnDeleteGroup.appendChild(delText);
    btnDeleteGroup.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onDeleteGroupFiles(group);
    });
    right.appendChild(btnDeleteGroup);
  }

  const toggleHint = document.createElement('span');
  toggleHint.className = 'group-toggle-hint';
  toggleHint.textContent = isCollapsed ? 'Buka' : 'Lipat';
  right.appendChild(toggleHint);

  bar.appendChild(left);
  bar.appendChild(right);

  return { bar, chevron, toggleHint };
}

/**
 * Creates a compact table cell (<td>) displaying a track index and file name (with optional folder badge & action buttons).
 */
export function createFileNameCell(fileObj, opts = {}) {
  const tdName = document.createElement('td');
  tdName.className = 'file-name-cell';

  const showFolder = Boolean(opts.showFolderBadge && fileObj.folder);
  const wrapper = document.createElement('div');
  wrapper.className = 'file-name-inline';

  if (typeof opts.index === 'number') {
    const idxSpan = document.createElement('span');
    idxSpan.className = 'track-index-badge';
    idxSpan.textContent = String(opts.index).padStart(2, '0');
    wrapper.appendChild(idxSpan);
  }

  if (showFolder) {
    const folderBadge = document.createElement('span');
    folderBadge.className = 'playlist-folder-badge row-folder-tag';
    folderBadge.textContent = '📁 ' + fileObj.folder;
    folderBadge.title = 'Folder: ' + fileObj.folder;
    wrapper.appendChild(folderBadge);
  }

  const titleSpan = document.createElement('span');
  titleSpan.className = 'file-title-text';
  titleSpan.textContent = fileObj.name;
  titleSpan.title = fileObj.rel_path || fileObj.name;
  wrapper.appendChild(titleSpan);

  if (typeof opts.onRename === 'function') {
    const btnRename = document.createElement('button');
    btnRename.type = 'button';
    btnRename.className = 'btn-file-rename';
    btnRename.title = 'Ubah nama file audio ini';
    btnRename.appendChild(createEditIcon());
    btnRename.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onRename(fileObj);
    });
    wrapper.appendChild(btnRename);
  }

  if (typeof opts.onDelete === 'function') {
    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'btn-file-delete';
    btnDelete.title = 'Hapus file audio ini';
    btnDelete.appendChild(createTrashIcon());
    btnDelete.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onDelete(fileObj);
    });
    wrapper.appendChild(btnDelete);
  }

  tdName.appendChild(wrapper);
  return tdName;
}

/**
 * Creates a reusable controller for collapsing/expanding grouped table rows across pages.
 */
export function createGroupCollapseController(opts) {
  const { collapsedGroups, groupDomMap, btnCollapseAll, btnExpandAll } = opts;

  function setGroupCollapsed(groupKey, collapse) {
    if (collapse) collapsedGroups.add(groupKey);
    else collapsedGroups.delete(groupKey);

    const domEntry = groupDomMap.get(groupKey);
    if (!domEntry) return;
    domEntry.chevron.classList.toggle('collapsed', collapse);
    domEntry.toggleHint.textContent = collapse ? 'Buka' : 'Lipat';
    domEntry.childRows.forEach(tr => {
      tr.classList.toggle('group-row-hidden', collapse);
    });
  }

  function toggleGroup(groupKey) {
    setGroupCollapsed(groupKey, !collapsedGroups.has(groupKey));
  }

  function collapseAll() {
    groupDomMap.forEach((_, key) => setGroupCollapsed(key, true));
  }

  function expandAll() {
    groupDomMap.forEach((_, key) => setGroupCollapsed(key, false));
  }

  if (btnCollapseAll) {
    btnCollapseAll.addEventListener('click', collapseAll);
  }
  if (btnExpandAll) {
    btnExpandAll.addEventListener('click', expandAll);
  }

  return { setGroupCollapsed, toggleGroup, collapseAll, expandAll };
}
