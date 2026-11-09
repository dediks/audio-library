/**
 * SWARARIA AUDIO LAB - Stage 4: Tag & File Organizer Client Logic
 * Strict DOM Manipulation (No innerHTML, strictly textContent & createElement)
 */

import {
  initAppHeader,
  apiGet,
  apiPost,
  notify,
  groupFiles,
  createGroupHeaderBar,
  createFileNameCell,
  createGroupCollapseController,
  openRenameModal,
  openDeleteModal,
  openFolderInExplorer,
  getSharedWorkspaceState,
  saveSharedWorkspaceState,
} from './modules/ui-shared.js';
import { initFolderModal } from './modules/folder-modal.js';

document.addEventListener('DOMContentLoaded', () => {
  initAppHeader({ activePage: 'organizer' });

  const numberingModeSelect = document.getElementById('numberingModeSelect');
  const sortBySelect = document.getElementById('sortBySelect');
  const organizeTemplateSelect = document.getElementById('organizeTemplateSelect');
  const btnOrganizeFolders = document.getElementById('btnOrganizeFolders');
  const btnOrganizeFoldersText = document.getElementById('btnOrganizeFoldersText');
  const startNumberInput = document.getElementById('startNumberInput');
  const chkStripYtId = document.getElementById('chkStripYtId');
  const chkStripJunkTags = document.getElementById('chkStripJunkTags');
  const chkCleanSpaces = document.getElementById('chkCleanSpaces');
  const studioTargetHint = document.getElementById('studioTargetHint');
  const btnApplyBatchRename = document.getElementById('btnApplyBatchRename');
  const btnApplyBatchRenameText = document.getElementById('btnApplyBatchRenameText');
  const previewSummaryBadge = document.getElementById('previewSummaryBadge');
  const organizerPreviewList = document.getElementById('organizerPreviewList');

  const btnOpenExplorer = document.getElementById('btnOpenExplorer');
  const btnSelectNonMp3 = document.getElementById('btnSelectNonMp3');
  const btnDeleteSelected = document.getElementById('btnDeleteSelected');
  const btnDeleteSelectedText = document.getElementById('btnDeleteSelectedText');

  const activeSourceBadge = document.getElementById('activeSourceBadge');
  const sourceDirInput = document.getElementById('sourceDirInput');
  const btnBrowseSource = document.getElementById('btnBrowseSource');
  const btnResetInbox = document.getElementById('btnResetInbox');
  const playlistGrid = document.getElementById('playlistGrid');

  const searchInput = document.getElementById('searchInput');
  const groupByMode = document.getElementById('groupByMode');
  const filterFormat = document.getElementById('filterFormat');

  const selectionCounterPill = document.getElementById('selectionCounterPill');
  const btnCollapseAllGroups = document.getElementById('btnCollapseAllGroups');
  const btnExpandAllGroups = document.getElementById('btnExpandAllGroups');
  const btnSelectVisible = document.getElementById('btnSelectVisible');
  const btnClearSelection = document.getElementById('btnClearSelection');

  const chkSelectAllVisible = document.getElementById('chkSelectAllVisible');
  const organizerTableBody = document.getElementById('organizerTableBody');

  // Shared Workspace State
  const sharedInit = getSharedWorkspaceState();
  let currentSourceDir = sharedInit.sourceDir || '';
  let defaultInboxDir = '';
  let activePlaylist = sharedInit.activePlaylist || 'ALL';
  const selectedPaths = new Set(Array.isArray(sharedInit.selectedPaths) ? sharedInit.selectedPaths : []);

  let allFiles = [];
  let allPlaylists = [];
  let visibleFiles = [];
  let lastClickedIndex = null;
  const collapsedGroups = new Set();
  const rowElementsByPath = new Map();
  const groupDomMap = new Map();
  let previewDebounceTimer = null;
  let lastPreviewPlan = null; // {rel_path: new_rel_path} from the latest preview, sent back on apply

  const groupCollapseCtrl = createGroupCollapseController({
    collapsedGroups,
    groupDomMap,
    btnCollapseAll: btnCollapseAllGroups,
    btnExpandAll: btnExpandAllGroups,
  });

  function persistWorkspaceState() {
    saveSharedWorkspaceState({
      sourceDir: currentSourceDir,
      activePlaylist,
      selectedPaths: Array.from(selectedPaths),
    });
  }

  function getStudioOptions() {
    const startVal = parseInt(startNumberInput ? startNumberInput.value : '1', 10);
    return {
      numbering_mode: numberingModeSelect ? numberingModeSelect.value : '2digit_dash',
      start_number: Number.isNaN(startVal) ? 1 : Math.max(0, startVal),
      strip_yt_id: chkStripYtId ? chkStripYtId.checked : true,
      strip_junk_tags: chkStripJunkTags ? chkStripJunkTags.checked : true,
      clean_spaces: chkCleanSpaces ? chkCleanSpaces.checked : true,
      sort_by: sortBySelect ? sortBySelect.value : 'selection',
    };
  }

  /**
   * Instant client-side preview matching fs_browser.py clean_and_number_filename
   */
  function simulateCleanName(filename, trackIdx, opts) {
    const dotIdx = filename.lastIndexOf('.');
    const stemRaw = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
    const ext = dotIdx > 0 ? filename.slice(dotIdx) : '';
    let stem = stemRaw;

    if (opts.strip_yt_id) {
      stem = stem.replace(/\s*\[[A-Za-z0-9_-]{11}\]$/g, '');
    }
    if (opts.strip_junk_tags) {
      // Mirrors fs_browser.py: bracketed tags (any junk word), then strong trailing "- Official Video" style tags.
      const junkAll = '(?:official\\s*(?:music\\s*)?(?:video|audio|lyric\\s*video|lyrics|visualizer|mv)|music\\s*video|lyric\\s*video|lyrics?|lirik(?:\\s*lagu)?|video\\s*klip|visualizer|audio\\s*only|full\\s*album|karaoke(?:\\s*version)?|hd|hq|4k(?:\\s*uhd)?|1080p|720p|mv|ost)';
      const junkStrong = '(?:official\\s*(?:music\\s*)?(?:video|audio|lyric\\s*video|lyrics|visualizer|mv)|music\\s*video|lyric\\s*video|lyrics?|lirik(?:\\s*lagu)?|video\\s*klip|visualizer|audio\\s*only|full\\s*album)';
      stem = stem.replace(new RegExp(`[\\(\\[\\{]\\s*${junkAll}\\s*[\\)\\]\\}]`, 'gi'), ' ');
      stem = stem.replace(new RegExp(`(?:[｜|\\-–—]+\\s*)${junkStrong}\\s*$`, 'i'), '');
    }
    if (opts.clean_spaces) {
      stem = stem.replace(/_/g, ' ');
      stem = stem.replace(/\s*[｜|•·]\s*/g, ' - ');
      stem = stem.replace(/\s+/g, ' ');
      stem = stem.replace(/(?:\s*-\s*){2,}/g, ' - ');
      stem = stem.replace(/^[\s\-–—.]+|[\s\-–—.]+$/g, '');
    }
    if (opts.numbering_mode !== 'none' && trackIdx !== null) {
      stem = stem.replace(/^\s*\d{1,3}\s*(?:[-._)]+|\s+-)\s*(?!\d)/, '');
    }
    stem = stem.trim() || stemRaw.trim() || 'Track';

    let prefix = '';
    if (opts.numbering_mode === '2digit_dash' && trackIdx !== null) {
      prefix = `${String(trackIdx).padStart(2, '0')} - `;
    } else if (opts.numbering_mode === '3digit_dash' && trackIdx !== null) {
      prefix = `${String(trackIdx).padStart(3, '0')} - `;
    } else if (opts.numbering_mode === '2digit_dot' && trackIdx !== null) {
      prefix = `${String(trackIdx).padStart(2, '0')}. `;
    }

    return `${prefix}${stem}${ext}`;
  }

  function syncSourceLocationUI() {
    const isDefault =
      !currentSourceDir ||
      (defaultInboxDir && currentSourceDir === defaultInboxDir) ||
      currentSourceDir.endsWith('/library/inbox') ||
      currentSourceDir.endsWith('\\library\\inbox');
    if (activeSourceBadge) {
      activeSourceBadge.textContent = isDefault
        ? 'library/inbox (App Default Collection)'
        : currentSourceDir;
      activeSourceBadge.title = currentSourceDir || 'library/inbox';
    }
    if (btnResetInbox) {
      btnResetInbox.classList.toggle('hidden', isDefault);
    }
  }

  async function fetchLibrary(customSource) {
    const targetSource = typeof customSource === 'string' ? customSource.trim() : currentSourceDir;
    const url = targetSource
      ? '/api/library?source_dir=' + encodeURIComponent(targetSource)
      : '/api/library';
    const { ok, data, error } = await apiGet(url);
    if (!ok) {
      notify({
        type: 'error',
        title: 'Failed to Load Collection',
        message: error || 'Could not read the source folder.',
        playSound: true,
      });
      return false;
    }

    if (data.default_inbox) defaultInboxDir = data.default_inbox;
    if (data.source_dir) {
      currentSourceDir = data.source_dir;
      if (sourceDirInput) sourceDirInput.value = data.source_dir;
    }
    syncSourceLocationUI();

    allFiles = data.files || [];
    allPlaylists = data.playlists || [];

    const validSet = new Set(allFiles.map(f => f.rel_path));
    Array.from(selectedPaths).forEach(p => {
      if (!validSet.has(p)) selectedPaths.delete(p);
    });

    renderPlaylists();
    applyFiltersAndRenderTable();
    updateSelectionUI();
    persistWorkspaceState();
    return true;
  }

  function renderPlaylists() {
    if (!playlistGrid) return;
    playlistGrid.replaceChildren();

    const totalSongs = allFiles.length;
    const totalMp3 = allFiles.filter(f => f.ext === '.mp3').length;
    const fragment = document.createDocumentFragment();

    fragment.appendChild(
      createPlaylistCard('ALL', 'All Collections (Show All)', `${totalSongs} songs total`, `${totalMp3} MP3`)
    );

    allPlaylists.forEach(pl => {
      const displayLabel = pl.label || ('📁 ' + pl.name);
      const subText = `${pl.total} songs`;
      const badgeText = pl.mp3_count > 0 ? `${pl.mp3_count} MP3` : `${pl.other_count} Native`;
      fragment.appendChild(createPlaylistCard(pl.name, displayLabel, subText, badgeText));
    });

    playlistGrid.appendChild(fragment);
  }

  function createPlaylistCard(id, title, countText, badgeText) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'playlist-card' + (activePlaylist === id ? ' active' : '');

    const topRow = document.createElement('div');
    topRow.className = 'playlist-card-top';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'playlist-card-title';
    nameSpan.textContent = title;
    nameSpan.title = title;
    topRow.appendChild(nameSpan);

    const badgeSpan = document.createElement('span');
    badgeSpan.className = 'playlist-card-badge';
    badgeSpan.textContent = badgeText;
    topRow.appendChild(badgeSpan);

    const bottomRow = document.createElement('div');
    bottomRow.className = 'playlist-card-sub';
    bottomRow.textContent = countText;

    btn.appendChild(topRow);
    btn.appendChild(bottomRow);

    btn.addEventListener('click', () => {
      activePlaylist = id;
      lastClickedIndex = null;
      renderPlaylists();
      applyFiltersAndRenderTable();
      persistWorkspaceState();
    });

    return btn;
  }

  function applyFiltersAndRenderTable() {
    const query = (searchInput && searchInput.value ? searchInput.value : '').trim().toLowerCase();
    const fmtFilter = filterFormat ? filterFormat.value : 'ALL';

    visibleFiles = allFiles.filter(f => {
      if (activePlaylist === '__ROOT__') {
        if (f.folder !== '') return false;
      } else if (activePlaylist !== 'ALL') {
        const topFolder = (f.folder || '').split('/')[0];
        if (topFolder !== activePlaylist && f.folder !== activePlaylist) return false;
      }

      if (query && !f.name.toLowerCase().includes(query) && !(f.folder || '').toLowerCase().includes(query)) {
        return false;
      }

      if (fmtFilter !== 'ALL' && f.ext !== fmtFilter) {
        return false;
      }

      return true;
    });

    renderTableRows();
    syncRowSelectionDOM();
  }

  function renderTableRows() {
    organizerTableBody.replaceChildren();
    rowElementsByPath.clear();
    groupDomMap.clear();

    if (visibleFiles.length === 0) {
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      const td = document.createElement('td');
      td.setAttribute('colspan', '6');
      td.textContent = 'No audio files match the current filter.';
      tr.appendChild(td);
      organizerTableBody.appendChild(tr);
      return;
    }

    const opts = getStudioOptions();
    const currentGroupBy = groupByMode ? groupByMode.value : 'folder';
    const showRowFolder = currentGroupBy === 'type' || currentGroupBy === 'rate';
    const groups = groupFiles(visibleFiles, currentGroupBy);
    const fragment = document.createDocumentFragment();
    let flatIdx = 0;

    groups.forEach(group => {
      const isCollapsed = collapsedGroups.has(group.key);
      const groupFilePaths = group.files.map(f => f.rel_path);

      const headerTr = document.createElement('tr');
      headerTr.className = 'group-header-row';

      const tdGroupCheck = document.createElement('td');
      tdGroupCheck.className = 'col-check';
      const groupChk = document.createElement('input');
      groupChk.type = 'checkbox';
      groupChk.title = `Select all songs in group "${group.label}"`;
      groupChk.addEventListener('click', (e) => {
        e.stopPropagation();
        const checkAll = groupChk.checked;
        groupFilePaths.forEach(rp => {
          if (checkAll) selectedPaths.add(rp);
          else selectedPaths.delete(rp);
        });
        syncRowSelectionDOM();
        persistWorkspaceState();
      });
      tdGroupCheck.appendChild(groupChk);
      headerTr.appendChild(tdGroupCheck);

      const headerTd = document.createElement('td');
      headerTd.setAttribute('colspan', '5');
      const { bar, chevron, toggleHint } = createGroupHeaderBar(group, isCollapsed, {
        onOpenExplorer: (g) => {
          openFolderInExplorer(g.isRoot ? '' : (g.folderPath || g.key), currentSourceDir);
        },
        onRenameFolder: (g) => {
          handleRenameFolder(g);
        },
        onDeleteFolder: (g) => {
          handleDeleteFolder(g);
        },
        onDeleteGroupFiles: (g) => {
          handleDeleteGroupFiles(g);
        },
      });
      headerTd.appendChild(bar);
      headerTr.appendChild(headerTd);

      headerTr.addEventListener('click', () => {
        groupCollapseCtrl.toggleGroup(group.key);
      });

      fragment.appendChild(headerTr);

      const childRows = [];

      group.files.forEach((f, groupIdx) => {
        const currentFlatIdx = flatIdx++;
        const tr = document.createElement('tr');
        const isSelected = selectedPaths.has(f.rel_path);
        if (isSelected) tr.classList.add('row-selected');
        if (isCollapsed) tr.classList.add('group-row-hidden');

        // 1. Checkbox
        const tdCheck = document.createElement('td');
        tdCheck.className = 'col-check';
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = isSelected;
        chk.setAttribute('aria-label', 'Select ' + f.name);
        chk.addEventListener('click', (e) => {
          e.stopPropagation();
          handleRowSelect(currentFlatIdx, f.rel_path, chk.checked, e.shiftKey);
        });
        tdCheck.appendChild(chk);
        tr.appendChild(tdCheck);

        tr.addEventListener('click', (e) => {
          const newChecked = !selectedPaths.has(f.rel_path);
          handleRowSelect(currentFlatIdx, f.rel_path, newChecked, e.shiftKey);
        });

        // 2. Current File Name with Rename & Delete icons
        tr.appendChild(
          createFileNameCell(f, {
            index: groupIdx + 1,
            showFolderBadge: showRowFolder,
            onRename: (fileObj) => handleRenameFile(fileObj),
            onDelete: (fileObj) => handleDeleteFile(fileObj),
          })
        );

        // 3. Simulated New Name Cell
        const tdSim = document.createElement('td');
        tdSim.className = 'mono-cell';
        const simSpan = document.createElement('span');
        const trackNo = opts.start_number + groupIdx;
        const simName = simulateCleanName(f.name, trackNo, opts);
        simSpan.textContent = simName;
        if (simName !== f.name) {
          simSpan.style.color = '#34d399';
          simSpan.style.fontWeight = '600';
        } else {
          simSpan.style.color = 'var(--text-muted)';
        }
        tdSim.appendChild(simSpan);
        tr.appendChild(tdSim);

        rowElementsByPath.set(f.rel_path, { tr, chk, simSpan, fileObj: f, groupIdx });

        // 4. Folder Playlist
        const tdFolder = document.createElement('td');
        tdFolder.className = 'mono-cell';
        tdFolder.textContent = f.folder ? `📁 ${f.folder}` : 'Root Inbox';
        tr.appendChild(tdFolder);

        // 5. Tipe File
        const tdExt = document.createElement('td');
        tdExt.className = 'mono-cell';
        const extBadge = document.createElement('span');
        extBadge.className = f.ext === '.mp3' ? 'rate-tag match' : 'rate-tag diff';
        extBadge.textContent = (f.ext || '').toUpperCase();
        tdExt.appendChild(extBadge);
        tr.appendChild(tdExt);

        // 6. Ukuran File
        const tdSize = document.createElement('td');
        tdSize.className = 'mono-cell';
        tdSize.textContent = `${f.size_mb} MB`;
        tr.appendChild(tdSize);

        fragment.appendChild(tr);
        childRows.push(tr);
      });

      groupDomMap.set(group.key, {
        childRows,
        chevron,
        toggleHint,
        groupChk,
        filePaths: groupFilePaths,
      });
    });

    organizerTableBody.appendChild(fragment);
  }

  function refreshInlineSimulatedNames() {
    const opts = getStudioOptions();
    // If files are selected, number them in selection/visible order; otherwise number by group index
    const selectedOrderMap = new Map();
    let seq = opts.start_number;
    visibleFiles.forEach(f => {
      if (selectedPaths.has(f.rel_path)) {
        selectedOrderMap.set(f.rel_path, seq++);
      }
    });

    rowElementsByPath.forEach(({ simSpan, fileObj, groupIdx }, relPath) => {
      const trackNo = selectedOrderMap.has(relPath)
        ? selectedOrderMap.get(relPath)
        : (opts.start_number + groupIdx);
      const simName = simulateCleanName(fileObj.name, trackNo, opts);
      simSpan.textContent = simName;
      if (simName !== fileObj.name) {
        simSpan.style.color = '#34d399';
        simSpan.style.fontWeight = '600';
      } else {
        simSpan.style.color = 'var(--text-muted)';
        simSpan.style.fontWeight = '400';
      }
    });
  }

  async function refreshLiveStudioPreview() {
    refreshInlineSimulatedNames();
    const relPaths = visibleFiles
      .filter(f => selectedPaths.has(f.rel_path))
      .map(f => f.rel_path);

    // Include any selected paths not currently in visibleFiles
    selectedPaths.forEach(p => {
      if (!relPaths.includes(p)) relPaths.push(p);
    });

    if (relPaths.length === 0) {
      organizerPreviewList.replaceChildren();
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'notif-empty';
      emptyDiv.textContent = 'Check songs or playlist folders in the table below to see a live simulation of the file renames.';
      organizerPreviewList.appendChild(emptyDiv);
      if (previewSummaryBadge) previewSummaryBadge.textContent = '0 selected';
      if (studioTargetHint) studioTargetHint.textContent = 'Check songs in the table below to preview the renames';
      if (btnApplyBatchRename) btnApplyBatchRename.disabled = true;
      if (btnApplyBatchRenameText) btnApplyBatchRenameText.textContent = 'Apply Rename (0 Files)';
      return;
    }

    const opts = getStudioOptions();
    const { ok, data } = await apiPost('/api/batch-rename', {
      source_dir: currentSourceDir || null,
      rel_paths: relPaths,
      numbering_mode: opts.numbering_mode,
      start_number: opts.start_number,
      strip_yt_id: opts.strip_yt_id,
      strip_junk_tags: opts.strip_junk_tags,
      clean_spaces: opts.clean_spaces,
      sort_by: opts.sort_by,
      preview: true,
    });

    if (!ok || !data) return;

    const items = data.items || [];
    lastPreviewPlan = {};
    items.forEach(it => { lastPreviewPlan[it.rel_path] = it.new_rel_path; });

    // The server plan is authoritative: reflect it in the inline "new name" column of the table.
    items.forEach(it => {
      const entry = rowElementsByPath.get(it.rel_path);
      if (!entry || !entry.simSpan) return;
      entry.simSpan.textContent = it.new_name;
      entry.simSpan.style.color = it.changed ? '#34d399' : 'var(--text-muted)';
      entry.simSpan.style.fontWeight = it.changed ? '600' : '400';
    });
    const changedCount = data.changed_count || 0;
    if (previewSummaryBadge) {
      previewSummaryBadge.textContent = `${changedCount} changed • ${items.length - changedCount} unchanged`;
    }
    if (studioTargetHint) {
      studioTargetHint.textContent = `${changedCount} of ${items.length} selected files ready to rename`;
    }
    if (btnApplyBatchRename) {
      btnApplyBatchRename.disabled = changedCount === 0;
    }
    if (btnApplyBatchRenameText) {
      btnApplyBatchRenameText.textContent = `Apply Rename (${changedCount} Files)`;
    }

    organizerPreviewList.replaceChildren();
    const frag = document.createDocumentFragment();
    items.slice(0, 120).forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'batch-rename-preview-item' + (item.changed ? ' is-changed' : ' is-unchanged');

      const numSpan = document.createElement('span');
      numSpan.className = 'delete-target-idx';
      numSpan.textContent = String(idx + 1).padStart(2, '0');
      row.appendChild(numSpan);

      const namesCol = document.createElement('div');
      namesCol.className = 'batch-rename-names-col';

      const oldLine = document.createElement('div');
      oldLine.className = 'batch-rename-old';
      oldLine.textContent = item.old_name;
      namesCol.appendChild(oldLine);

      const newLine = document.createElement('div');
      newLine.className = 'batch-rename-new';
      newLine.textContent = item.changed ? `→ ${item.new_name}` : '  (Already tidy / unchanged)';
      namesCol.appendChild(newLine);

      row.appendChild(namesCol);
      frag.appendChild(row);
    });
    organizerPreviewList.appendChild(frag);
  }

  function scheduleStudioPreview() {
    if (previewDebounceTimer) clearTimeout(previewDebounceTimer);
    previewDebounceTimer = setTimeout(() => {
      refreshLiveStudioPreview();
    }, 100);
  }

  function handleRowSelect(idx, relPath, checked, isShift) {
    if (isShift && lastClickedIndex !== null && lastClickedIndex !== idx) {
      const start = Math.min(lastClickedIndex, idx);
      const end = Math.max(lastClickedIndex, idx);
      for (let i = start; i <= end; i++) {
        const item = visibleFiles[i];
        if (item) {
          if (checked) selectedPaths.add(item.rel_path);
          else selectedPaths.delete(item.rel_path);
        }
      }
    } else {
      if (checked) selectedPaths.add(relPath);
      else selectedPaths.delete(relPath);
    }
    lastClickedIndex = idx;
    syncRowSelectionDOM();
    persistWorkspaceState();
  }

  function syncRowSelectionDOM() {
    rowElementsByPath.forEach(({ tr, chk }, relPath) => {
      const isSelected = selectedPaths.has(relPath);
      chk.checked = isSelected;
      tr.classList.toggle('row-selected', isSelected);
    });

    groupDomMap.forEach(({ groupChk, filePaths }) => {
      if (!groupChk || filePaths.length === 0) return;
      const selCount = filePaths.filter(rp => selectedPaths.has(rp)).length;
      groupChk.checked = selCount === filePaths.length;
      groupChk.indeterminate = selCount > 0 && selCount < filePaths.length;
    });

    if (chkSelectAllVisible) {
      if (visibleFiles.length === 0) {
        chkSelectAllVisible.checked = false;
        chkSelectAllVisible.indeterminate = false;
      } else {
        const visSel = visibleFiles.filter(f => selectedPaths.has(f.rel_path)).length;
        chkSelectAllVisible.checked = visSel === visibleFiles.length;
        chkSelectAllVisible.indeterminate = visSel > 0 && visSel < visibleFiles.length;
      }
    }

    updateSelectionUI();
    scheduleStudioPreview();
  }

  function updateSelectionUI() {
    const count = selectedPaths.size;
    if (selectionCounterPill) {
      selectionCounterPill.textContent = `${count} selected`;
    }
    if (btnDeleteSelectedText) {
      btnDeleteSelectedText.textContent = `Delete Selected (${count})`;
    }
    if (btnDeleteSelected) {
      btnDeleteSelected.disabled = count === 0;
    }
    if (btnOrganizeFolders) {
      btnOrganizeFolders.disabled = count === 0;
    }
    if (btnOrganizeFoldersText) {
      btnOrganizeFoldersText.textContent = `Organize into Folders (${count} Files)`;
    }
  }

  // Apply Batch Auto-Numbering & Tag Cleaner
  if (btnApplyBatchRename) {
    btnApplyBatchRename.addEventListener('click', async () => {
      if (selectedPaths.size === 0) return;
      const relPaths = visibleFiles
        .filter(f => selectedPaths.has(f.rel_path))
        .map(f => f.rel_path);
      selectedPaths.forEach(p => {
        if (!relPaths.includes(p)) relPaths.push(p);
      });

      const opts = getStudioOptions();
      btnApplyBatchRename.disabled = true;
      if (btnApplyBatchRenameText) btnApplyBatchRenameText.textContent = 'Applying Rename...';

      const { ok, data, error } = await apiPost('/api/batch-rename', {
        source_dir: currentSourceDir || null,
        rel_paths: relPaths,
        numbering_mode: opts.numbering_mode,
        start_number: opts.start_number,
        strip_yt_id: opts.strip_yt_id,
        strip_junk_tags: opts.strip_junk_tags,
        clean_spaces: opts.clean_spaces,
        sort_by: opts.sort_by,
        preview: false,
        expected_plan: lastPreviewPlan,
      });

      if (!ok) {
        btnApplyBatchRename.disabled = false;
        scheduleStudioPreview();
        notify({
          type: 'error',
          title: 'Failed to Apply Batch Rename',
          message: error || 'An error occurred while renaming files.',
          playSound: true,
        });
        return;
      }

      selectedPaths.clear();
      lastClickedIndex = null;
      lastPreviewPlan = null;
      notify({
        type: 'success',
        title: 'Batch Auto-Number & Rename Complete',
        message: data?.message || 'File names cleaned up successfully.',
        playSound: true,
      });
      await fetchLibrary();
      refreshUndoState();
    });
  }

  // Single & Group Rename / Delete Handlers
  function handleRenameFile(fileObj) {
    openRenameModal({
      title: 'Rename Audio File',
      oldName: fileObj.name,
      isFolder: false,
      onSave: async (newName) => {
        const { ok, data, error } = await apiPost('/api/rename', {
          source_dir: currentSourceDir,
          rel_path: fileObj.rel_path,
          new_name: newName,
          is_folder: false,
        });
        if (!ok) throw new Error(error || 'Failed to rename the file.');
        notify({
          type: 'success',
          title: 'File Renamed',
          message: `File renamed to: ${data?.new_name || newName}`,
        });
        await fetchLibrary();
      },
    });
  }

  function handleRenameFolder(group) {
    openRenameModal({
      title: 'Rename Playlist Folder',
      oldName: group.key.split('/').pop(),
      isFolder: true,
      onSave: async (newName) => {
        const { ok, data, error } = await apiPost('/api/rename', {
          source_dir: currentSourceDir,
          rel_path: group.key,
          new_name: newName,
          is_folder: true,
        });
        if (!ok) throw new Error(error || 'Failed to rename the folder.');
        if (activePlaylist === group.key) {
          activePlaylist = data?.rel_path || 'ALL';
        }
        notify({
          type: 'success',
          title: 'Folder Renamed',
          message: `Folder renamed to: ${data?.new_name || newName}`,
        });
        await fetchLibrary();
      },
    });
  }

  function handleDeleteFile(fileObj) {
    openDeleteModal({
      title: 'Delete Audio File',
      message: 'Are you sure you want to permanently delete this audio file from disk?',
      items: [fileObj.rel_path || fileObj.name],
      confirmLabel: 'Delete File',
      onConfirm: async () => {
        const { ok, data, error } = await apiPost('/api/delete', {
          source_dir: currentSourceDir,
          rel_path: fileObj.rel_path,
          is_folder: false,
        });
        if (!ok) throw new Error(error || 'Failed to delete the audio file.');
        selectedPaths.delete(fileObj.rel_path);
        notify({
          type: 'info',
          title: 'File Audio Dihapus',
          message: data?.message || `File "${fileObj.name}" deleted successfully.`,
        });
        await fetchLibrary();
      },
    });
  }

  function handleDeleteFolder(group) {
    openDeleteModal({
      title: 'Delete Playlist Folder',
      message: `The entire playlist folder "${group.label}" and its ${group.files.length} audio files (${group.totalSizeMb} MB) will be permanently deleted:`,
      items: [`📁 ${group.label} (${group.files.length} songs • ${group.totalSizeMb} MB)`],
      confirmLabel: 'Delete Folder & Songs',
      onConfirm: async () => {
        const { ok, data, error } = await apiPost('/api/delete', {
          source_dir: currentSourceDir,
          rel_path: group.key,
          is_folder: true,
        });
        if (!ok) throw new Error(error || 'Failed to delete the playlist folder.');
        group.files.forEach(f => selectedPaths.delete(f.rel_path));
        if (activePlaylist === group.key) activePlaylist = 'ALL';
        notify({
          type: 'info',
          title: 'Playlist Folder Deleted',
          message: data?.message || `Folder "${group.label}" deleted successfully.`,
        });
        await fetchLibrary();
      },
    });
  }

  function handleDeleteGroupFiles(group) {
    const relPaths = group.files.map(f => f.rel_path);
    if (relPaths.length === 0) return;
    openDeleteModal({
      title: `Delete Group: ${group.label}`,
      message: `${relPaths.length} audio files (${group.totalSizeMb} MB) in group "${group.label}" will be permanently deleted:`,
      items: relPaths,
      confirmLabel: `Delete ${relPaths.length} Files`,
      onConfirm: async () => {
        const { ok, data, error } = await apiPost('/api/delete', {
          source_dir: currentSourceDir,
          rel_paths: relPaths,
          is_folder: false,
        });
        if (!ok) throw new Error(error || 'Failed to delete the files in the group.');
        relPaths.forEach(rp => selectedPaths.delete(rp));
        lastClickedIndex = null;
        notify({
          type: 'info',
          title: 'Group Files Deleted',
          message: data?.message || `Deleted ${relPaths.length} files.`,
        });
        await fetchLibrary();
      },
    });
  }

  if (btnDeleteSelected) {
    btnDeleteSelected.addEventListener('click', () => {
      if (selectedPaths.size === 0) return;
      const relPaths = Array.from(selectedPaths);
      openDeleteModal({
        title: `Delete Batch (${relPaths.length} Selected Songs)`,
        message: `${relPaths.length} checked audio files will be permanently deleted from disk:`,
        items: relPaths,
        confirmLabel: `Delete ${relPaths.length} Songs`,
        onConfirm: async () => {
          const { ok, data, error } = await apiPost('/api/delete', {
            source_dir: currentSourceDir,
            rel_paths: relPaths,
            is_folder: false,
          });
          if (!ok) throw new Error(error || 'Failed to delete the selected songs.');
          selectedPaths.clear();
          lastClickedIndex = null;
          notify({
            type: 'info',
            title: 'Batch Delete Complete',
            message: data?.message || `Deleted ${relPaths.length} audio files.`,
          });
          await fetchLibrary();
        },
      });
    });
  }

  if (btnSelectNonMp3) {
    btnSelectNonMp3.addEventListener('click', () => {
      let count = 0;
      visibleFiles.forEach(f => {
        if (f.ext !== '.mp3') {
          selectedPaths.add(f.rel_path);
          count++;
        }
      });
      syncRowSelectionDOM();
      persistWorkspaceState();
      notify({
        type: count > 0 ? 'info' : 'warning',
        title: count > 0 ? `${count} Non-MP3 Files Selected` : 'No Non-MP3 Files',
        message: count > 0
          ? '.opus/.webm/.m4a files are selected and ready to delete or tidy up.'
          : 'All visible files are already .mp3.',
        duration: 3000,
      });
    });
  }

  // Studio Rule Change Listeners
  [numberingModeSelect, sortBySelect, startNumberInput, chkStripYtId, chkStripJunkTags, chkCleanSpaces].forEach(el => {
    if (!el) return;
    el.addEventListener('change', scheduleStudioPreview);
    el.addEventListener('input', scheduleStudioPreview);
  });

  if (searchInput) searchInput.addEventListener('input', applyFiltersAndRenderTable);
  if (groupByMode) {
    groupByMode.addEventListener('change', () => {
      collapsedGroups.clear();
      applyFiltersAndRenderTable();
    });
  }
  if (filterFormat) filterFormat.addEventListener('change', applyFiltersAndRenderTable);

  if (chkSelectAllVisible) {
    chkSelectAllVisible.addEventListener('change', () => {
      const check = chkSelectAllVisible.checked;
      visibleFiles.forEach(f => {
        if (check) selectedPaths.add(f.rel_path);
        else selectedPaths.delete(f.rel_path);
      });
      syncRowSelectionDOM();
      persistWorkspaceState();
    });
  }

  if (btnSelectVisible) {
    btnSelectVisible.addEventListener('click', () => {
      visibleFiles.forEach(f => selectedPaths.add(f.rel_path));
      syncRowSelectionDOM();
      persistWorkspaceState();
    });
  }

  if (btnClearSelection) {
    btnClearSelection.addEventListener('click', () => {
      selectedPaths.clear();
      lastClickedIndex = null;
      syncRowSelectionDOM();
      persistWorkspaceState();
    });
  }

  if (btnOpenExplorer) {
    btnOpenExplorer.addEventListener('click', () => {
      openFolderInExplorer('', currentSourceDir);
    });
  }

  if (btnResetInbox) {
    btnResetInbox.addEventListener('click', () => {
      selectedPaths.clear();
      activePlaylist = 'ALL';
      fetchLibrary(defaultInboxDir || '');
    });
  }

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
    getStartPath: () => currentSourceDir,
    onSelectSource: (chosenPath) => {
      selectedPaths.clear();
      activePlaylist = 'ALL';
      fetchLibrary(chosenPath);
    },
  });

  // Undo last batch rename
  const btnUndoRename = document.getElementById('btnUndoRename');
  const btnUndoRenameText = document.getElementById('btnUndoRenameText');

  async function refreshUndoState() {
    if (!btnUndoRename) return;
    const { ok, data } = await apiGet('/api/undo-rename');
    const last = ok && data ? data.last : null;
    btnUndoRename.disabled = !last;
    if (btnUndoRenameText) {
      btnUndoRenameText.textContent = last ? `Undo Last Rename (${last.count} Files)` : 'Undo Last Rename';
    }
  }

  if (btnUndoRename) {
    btnUndoRename.addEventListener('click', async () => {
      btnUndoRename.disabled = true;
      const { ok, data, error } = await apiPost('/api/undo-rename', {});
      notify({
        type: ok ? 'success' : 'error',
        title: ok ? 'Undo Rename Successful' : 'Undo Rename Failed',
        message: ok ? (data?.message || 'Rename undone.') : (error || 'Failed to undo the rename.'),
        playSound: true,
      });
      await fetchLibrary();
      await refreshUndoState();
    });
  }

  // Organize selected songs into Artist/Album folders based on tags
  if (btnOrganizeFolders) {
    btnOrganizeFolders.addEventListener('click', async () => {
      if (selectedPaths.size === 0) return;
      const relPaths = Array.from(selectedPaths);
      const template = organizeTemplateSelect ? organizeTemplateSelect.value : 'artist_album';
      btnOrganizeFolders.disabled = true;

      const prev = await apiPost('/api/organize-folders', {
        source_dir: currentSourceDir || null,
        rel_paths: relPaths,
        template,
        preview: true,
      });
      if (!prev.ok) {
        updateSelectionUI();
        notify({ type: 'error', title: 'Folder Organize Preview Failed', message: prev.error || 'Failed to read tags.', playSound: true });
        return;
      }

      const items = prev.data.items || [];
      const movable = items.filter(it => it.changed);
      if (movable.length === 0) {
        updateSelectionUI();
        notify({ type: 'info', title: 'No Changes', message: prev.data.message || 'All files are already in the right folders.' });
        return;
      }
      const expected = {};
      items.forEach(it => { expected[it.rel_path] = it.new_rel_path; });

      updateSelectionUI();
      openDeleteModal({
        title: `Organize ${movable.length} Songs into Folders`,
        message: `${prev.data.message || ''} Songs will be moved (can be undone with Undo):`,
        items: movable.map(it => `${it.rel_path}  →  ${it.new_rel_path}`),
        confirmLabel: `Move ${movable.length} Files`,
        onConfirm: async () => {
          const res = await apiPost('/api/organize-folders', {
            source_dir: currentSourceDir || null,
            rel_paths: relPaths,
            template,
            preview: false,
            expected_plan: expected,
          });
          if (!res.ok) throw new Error(res.error || 'Failed to move the files.');
          selectedPaths.clear();
          lastClickedIndex = null;
          lastPreviewPlan = null;
          notify({
            type: 'success',
            title: 'Organize Folders Complete',
            message: res.data?.message || 'Files moved successfully.',
            playSound: true,
          });
          await fetchLibrary();
          refreshUndoState();
        },
      });
    });
  }

  fetchLibrary(currentSourceDir);
  refreshUndoState();
});
