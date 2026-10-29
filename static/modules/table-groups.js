/**
 * Audio Lab - Shared Table Grouping & Collapsible Folder Row Components
 * Strict DOM Manipulation (No innerHTML, strictly textContent & createElement)
 */

import { createExplorerIcon, createEditIcon, createTrashIcon } from './dom-icons.js';

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

  // Quick Action: Open in Windows Explorer
  if (typeof opts.onOpenExplorer === 'function') {
    const btnExplorer = document.createElement('button');
    btnExplorer.type = 'button';
    btnExplorer.className = 'btn-group-action';
    btnExplorer.title = 'Buka folder ini di Windows Explorer';
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

  // Quick Action: Rename Folder (only for subfolders/playlists, not inbox root)
  if (typeof opts.onRenameFolder === 'function' && !group.isRoot) {
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

  // Quick Action: Delete Folder (only for subfolders/playlists, not inbox root)
  if (typeof opts.onDeleteFolder === 'function' && !group.isRoot) {
    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'btn-group-action btn-group-danger';
    btnDelete.title = 'Hapus folder playlist ini beserta seluruh lagu di dalamnya';
    btnDelete.appendChild(createTrashIcon());
    const delText = document.createElement('span');
    delText.textContent = 'Hapus';
    btnDelete.appendChild(delText);
    btnDelete.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onDeleteFolder(group);
    });
    right.appendChild(btnDelete);
  }

  const toggleHint = document.createElement('span');
  toggleHint.className = 'group-toggle-hint';
  toggleHint.textContent = isCollapsed ? 'Buka Daftar' : 'Lipat';
  right.appendChild(toggleHint);

  bar.appendChild(left);
  bar.appendChild(right);

  return { bar, chevron, toggleHint };
}

/**
 * Creates a compact table cell (<td>) displaying a track index and file name (with optional folder badge & rename button).
 * @param {{ name: string, folder?: string, rel_path?: string }} fileObj
 * @param {{ index?: number, showFolderBadge?: boolean, onRename?: (file: any) => void }} opts
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
 * @param {{
 *   collapsedGroups: Set<string>,
 *   groupDomMap: Map<string, { childRows: HTMLTableRowElement[], chevron: HTMLElement, toggleHint: HTMLElement }>,
 *   btnCollapseAll?: HTMLElement | null,
 *   btnExpandAll?: HTMLElement | null
 * }} opts
 */
export function createGroupCollapseController(opts) {
  const { collapsedGroups, groupDomMap, btnCollapseAll, btnExpandAll } = opts;

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

