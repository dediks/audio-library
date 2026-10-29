/**
 * Audio Lab - Interactive Folder Browser Modal Module
 * Strict DOM Manipulation (No innerHTML, strictly textContent & createElement)
 */

import { notify, apiPost } from './ui-shared.js';

/**
 * Initializes the folder browser modal for selecting Source or Destination directories.
 * @param {{
 *   folderModal: HTMLElement | null,
 *   folderModalTitle: HTMLElement | null,
 *   btnCloseModal: HTMLElement | null,
 *   modalShortcuts: HTMLElement | null,
 *   btnModalUp: HTMLButtonElement | null,
 *   modalCurrentPath: HTMLElement | null,
 *   modalDirList: HTMLElement | null,
 *   newFolderNameInput: HTMLInputElement | null,
 *   btnCreateSubfolder: HTMLButtonElement | null,
 *   btnCancelModal: HTMLButtonElement | null,
 *   btnSelectModalDir: HTMLButtonElement | null,
 *   btnBrowseSource?: HTMLButtonElement | null,
 *   btnBrowseDest?: HTMLButtonElement | null,
 *   getStartPath: (mode: 'source' | 'dest') => string,
 *   onSelectSource: (selectedPath: string) => void,
 *   onSelectDest: (selectedPath: string) => void,
 *   onLog: (level: 'info' | 'warn' | 'error', message: string) => void
 * }} opts
 */
export function initFolderModal(opts) {
  const {
    folderModal,
    folderModalTitle,
    btnCloseModal,
    modalShortcuts,
    btnModalUp,
    modalCurrentPath,
    modalDirList,
    newFolderNameInput,
    btnCreateSubfolder,
    btnCancelModal,
    btnSelectModalDir,
    btnBrowseSource,
    btnBrowseDest,
    getStartPath,
    onSelectSource,
    onSelectDest,
    onLog,
  } = opts;

  let modalTargetMode = 'source'; // 'source' | 'dest'
  let modalBrowsingPath = '';
  let modalParentPath = null;

  async function browseTo(pathStr, createSubfolder) {
    if (!modalDirList) return;
    const payload = { path: pathStr || '' };
    if (createSubfolder) payload.create_subfolder = createSubfolder;

    const { ok, data, error } = await apiPost('/api/browse-dirs', payload);
    if (!ok) {
      const errMsg = error || 'Gagal membuka direktori.';
      onLog('error', '[BROWSER] ' + errMsg);
      notify({
        type: 'error',
        title: 'Gagal Membuka Direktori',
        message: errMsg,
        playSound: true,
      });
      return;
    }

    if (createSubfolder) {
      notify({
        type: 'success',
        title: 'Folder Baru Dibuat',
        message: 'Berhasil membuat dan membuka folder: ' + (data.current || createSubfolder),
        duration: 3800,
      });
    }

    modalBrowsingPath = data.current || '';
    modalParentPath = data.parent || null;
    if (modalCurrentPath) modalCurrentPath.textContent = modalBrowsingPath;
    if (btnModalUp) btnModalUp.disabled = !modalParentPath;

    // Render quick shortcuts
    if (modalShortcuts && Array.isArray(data.shortcuts)) {
      modalShortcuts.replaceChildren();
      data.shortcuts.forEach(sc => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-chip';
        btn.textContent = sc.label;
        btn.title = sc.path;
        btn.addEventListener('click', () => browseTo(sc.path));
        modalShortcuts.appendChild(btn);
      });
    }

    // Render subdirectories
    modalDirList.replaceChildren();
    const dirs = data.dirs || [];
    if (dirs.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'modal-dir-empty';
      emptyMsg.textContent = 'Tidak ada subfolder di dalam direktori ini.';
      modalDirList.appendChild(emptyMsg);
    } else {
      dirs.forEach(d => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'modal-dir-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'modal-dir-name';
        nameSpan.textContent = '📁 ' + d.name;

        const countSpan = document.createElement('span');
        countSpan.className = 'modal-dir-meta';
        countSpan.textContent = d.audio_count > 0 ? (d.audio_count + ' file audio') : 'Buka →';

        row.appendChild(nameSpan);
        row.appendChild(countSpan);
        row.addEventListener('click', () => browseTo(d.path));
        modalDirList.appendChild(row);
      });
    }
  }

  function open(mode) {
    modalTargetMode = mode;
    if (folderModalTitle) {
      folderModalTitle.textContent = mode === 'source'
        ? 'Pilih Folder Sumber (Source Audio)'
        : 'Pilih Folder Tujuan (Destination Hasil Konversi)';
    }
    if (newFolderNameInput) newFolderNameInput.value = '';
    const startPath = typeof getStartPath === 'function' ? getStartPath(mode) : '';
    if (folderModal) folderModal.classList.remove('hidden');
    browseTo(startPath || '');
  }

  function close() {
    if (folderModal) folderModal.classList.add('hidden');
  }

  if (btnBrowseSource) {
    btnBrowseSource.addEventListener('click', () => open('source'));
  }
  if (btnBrowseDest) {
    btnBrowseDest.addEventListener('click', () => open('dest'));
  }
  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', close);
  }
  if (btnCancelModal) {
    btnCancelModal.addEventListener('click', close);
  }
  if (btnModalUp) {
    btnModalUp.addEventListener('click', () => {
      if (modalParentPath) browseTo(modalParentPath);
    });
  }
  if (btnCreateSubfolder && newFolderNameInput) {
    btnCreateSubfolder.addEventListener('click', () => {
      const subName = newFolderNameInput.value.trim();
      if (!subName) return;
      newFolderNameInput.value = '';
      browseTo(modalBrowsingPath, subName);
    });
  }
  if (btnSelectModalDir) {
    btnSelectModalDir.addEventListener('click', () => {
      if (!modalBrowsingPath) return;
      const chosen = modalBrowsingPath;
      close();
      if (modalTargetMode === 'source') {
        onSelectSource(chosen);
      } else {
        onSelectDest(chosen);
      }
    });
  }

  return { open, close, browseTo };
}
