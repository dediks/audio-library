/**
 * Audio Lab - Safe DOM Rename Modal Dialog Module
 * Strict DOM Manipulation (Zero innerHTML, strictly textContent & createElement)
 */

let modalBackdrop = null;
let modalTitle = null;
let modalTargetBadge = null;
let modalInput = null;
let modalExtBadge = null;
let modalError = null;
let btnCancel = null;
let btnSave = null;
let btnClose = null;

let currentResolve = null;

function ensureRenameModalMounted() {
  if (modalBackdrop) return;

  // 1. Backdrop
  modalBackdrop = document.createElement('div');
  modalBackdrop.className = 'modal-backdrop hidden';
  modalBackdrop.setAttribute('role', 'dialog');
  modalBackdrop.setAttribute('aria-modal', 'true');
  modalBackdrop.setAttribute('aria-labelledby', 'renameModalTitle');

  // 2. Card
  const card = document.createElement('div');
  card.className = 'modal-card modal-rename-card';

  // 3. Header
  const header = document.createElement('div');
  header.className = 'modal-header';

  modalTitle = document.createElement('h3');
  modalTitle.id = 'renameModalTitle';
  modalTitle.textContent = 'Ubah Nama';

  btnClose = document.createElement('button');
  btnClose.type = 'button';
  btnClose.className = 'btn-text';
  btnClose.textContent = '✕ Tutup';
  btnClose.addEventListener('click', closeRenameModal);

  header.appendChild(modalTitle);
  header.appendChild(btnClose);

  // 4. Body
  const body = document.createElement('div');
  body.className = 'modal-body';

  const descWrap = document.createElement('div');
  descWrap.className = 'rename-desc-wrap';

  const descLabel = document.createElement('span');
  descLabel.className = 'rename-desc-label';
  descLabel.textContent = 'Nama saat ini:';

  modalTargetBadge = document.createElement('code');
  modalTargetBadge.className = 'rename-target-badge';
  modalTargetBadge.textContent = '-';

  descWrap.appendChild(descLabel);
  descWrap.appendChild(modalTargetBadge);
  body.appendChild(descWrap);

  const fieldWrap = document.createElement('div');
  fieldWrap.className = 'field-group';

  const fieldLabel = document.createElement('label');
  fieldLabel.className = 'field-label';
  fieldLabel.htmlFor = 'renameModalInput';
  fieldLabel.textContent = 'Nama Baru';

  const inputWrap = document.createElement('div');
  inputWrap.className = 'rename-input-wrap';

  modalInput = document.createElement('input');
  modalInput.type = 'text';
  modalInput.id = 'renameModalInput';
  modalInput.className = 'toolbar-input rename-input';
  modalInput.autocomplete = 'off';
  modalInput.spellcheck = false;

  modalExtBadge = document.createElement('span');
  modalExtBadge.className = 'rename-ext-badge';
  modalExtBadge.style.display = 'none';

  inputWrap.appendChild(modalInput);
  inputWrap.appendChild(modalExtBadge);

  fieldWrap.appendChild(fieldLabel);
  fieldWrap.appendChild(inputWrap);
  body.appendChild(fieldWrap);

  modalError = document.createElement('div');
  modalError.className = 'rename-error-msg';
  modalError.style.display = 'none';
  body.appendChild(modalError);

  // 5. Footer
  const footer = document.createElement('div');
  footer.className = 'modal-footer';

  btnCancel = document.createElement('button');
  btnCancel.type = 'button';
  btnCancel.className = 'btn-secondary';
  btnCancel.textContent = 'Batal';
  btnCancel.addEventListener('click', closeRenameModal);

  btnSave = document.createElement('button');
  btnSave.type = 'button';
  btnSave.className = 'btn-primary';
  btnSave.textContent = 'Simpan Nama Baru';

  footer.appendChild(btnCancel);
  footer.appendChild(btnSave);

  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(footer);
  modalBackdrop.appendChild(card);

  // Close on backdrop click (outside card)
  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) {
      closeRenameModal();
    }
  });

  // Keyboard navigation
  window.addEventListener('keydown', (e) => {
    if (modalBackdrop.classList.contains('hidden')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeRenameModal();
    }
  });

  document.body.appendChild(modalBackdrop);
}

function closeRenameModal() {
  if (modalBackdrop) {
    modalBackdrop.classList.add('hidden');
  }
  if (modalError) {
    modalError.textContent = '';
    modalError.style.display = 'none';
  }
  if (currentResolve) {
    currentResolve(null);
    currentResolve = null;
  }
}

/**
 * Opens a modal to rename a file or folder.
 *
 * @param {{
 *   title?: string,
 *   oldName: string,
 *   isFolder?: boolean,
 *   onSave: (newName: string) => Promise<boolean | void>,
 * }} opts
 * @returns {Promise<boolean>}
 */
export function openRenameModal(opts) {
  ensureRenameModalMounted();

  const { title, oldName, isFolder = false, onSave } = opts;

  return new Promise((resolve) => {
    currentResolve = resolve;

    modalTitle.textContent = title || (isFolder ? 'Ubah Nama Folder Playlist' : 'Ubah Nama File Audio');
    modalTargetBadge.textContent = oldName;
    modalError.textContent = '';
    modalError.style.display = 'none';

    let initialValue = oldName;
    let extension = '';

    if (!isFolder && oldName.includes('.')) {
      const lastDot = oldName.lastIndexOf('.');
      initialValue = oldName.slice(0, lastDot);
      extension = oldName.slice(lastDot);
      modalExtBadge.textContent = extension;
      modalExtBadge.style.display = 'inline-flex';
    } else {
      modalExtBadge.textContent = '';
      modalExtBadge.style.display = 'none';
    }

    modalInput.value = initialValue;
    btnSave.disabled = false;
    btnSave.textContent = 'Simpan Nama Baru';

    // Submit handler
    const handleSubmit = async () => {
      const rawVal = modalInput.value.trim();
      if (!rawVal) {
        modalError.textContent = 'Nama tidak boleh kosong.';
        modalError.style.display = 'block';
        modalInput.focus();
        return;
      }

      if (rawVal.startsWith('.')) {
        modalError.textContent = 'Nama tidak boleh diawali dengan tanda titik (.).';
        modalError.style.display = 'block';
        modalInput.focus();
        return;
      }

      // Check forbidden characters: < > : " / \ | ? *
      if (/[<>:"/\\|?*]/.test(rawVal)) {
        modalError.textContent = 'Nama mengandung karakter terlarang (< > : " / \\ | ? *).';
        modalError.style.display = 'block';
        modalInput.focus();
        return;
      }

      const finalName = !isFolder && extension ? `${rawVal}${extension}` : rawVal;

      if (finalName === oldName) {
        closeRenameModal();
        resolve(false);
        return;
      }

      btnSave.disabled = true;
      btnSave.textContent = 'Menyimpan...';

      try {
        const result = await onSave(finalName);
        if (result === false) {
          btnSave.disabled = false;
          btnSave.textContent = 'Simpan Nama Baru';
          return;
        }
        closeRenameModal();
        resolve(true);
      } catch (err) {
        modalError.textContent = err.message || 'Gagal mengubah nama.';
        modalError.style.display = 'block';
        btnSave.disabled = false;
        btnSave.textContent = 'Simpan Nama Baru';
      }
    };

    // Remove existing listeners by replacing clone or resetting onclick
    btnSave.onclick = handleSubmit;
    modalInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    };

    modalBackdrop.classList.remove('hidden');
    setTimeout(() => {
      modalInput.focus();
      modalInput.select();
    }, 50);
  });
}

/* ==========================================================================
   Safe DOM Delete Confirmation Modal Dialog (Single File, Folder & Batch)
   ========================================================================== */

let delBackdrop = null;
let delTitle = null;
let delDesc = null;
let delItemList = null;
let delError = null;
let btnDelCancel = null;
let btnDelConfirm = null;
let btnDelClose = null;
let currentDelResolve = null;

function ensureDeleteModalMounted() {
  if (delBackdrop) return;

  delBackdrop = document.createElement('div');
  delBackdrop.className = 'modal-backdrop hidden';
  delBackdrop.setAttribute('role', 'dialog');
  delBackdrop.setAttribute('aria-modal', 'true');
  delBackdrop.setAttribute('aria-labelledby', 'deleteModalTitle');

  const card = document.createElement('div');
  card.className = 'modal-card modal-delete-card';

  const header = document.createElement('div');
  header.className = 'modal-header';

  delTitle = document.createElement('h3');
  delTitle.id = 'deleteModalTitle';
  delTitle.textContent = 'Konfirmasi Hapus';

  btnDelClose = document.createElement('button');
  btnDelClose.type = 'button';
  btnDelClose.className = 'btn-text';
  btnDelClose.textContent = '✕ Tutup';
  btnDelClose.addEventListener('click', closeDeleteModal);

  header.appendChild(delTitle);
  header.appendChild(btnDelClose);

  const body = document.createElement('div');
  body.className = 'modal-body';

  delDesc = document.createElement('div');
  delDesc.className = 'delete-warning-banner';
  delDesc.textContent = 'Item yang dihapus akan dihapus permanen dari penyimpanan disk dan tidak dapat dikembalikan.';
  body.appendChild(delDesc);

  delItemList = document.createElement('div');
  delItemList.className = 'delete-target-list';
  body.appendChild(delItemList);

  delError = document.createElement('div');
  delError.className = 'rename-error-msg';
  delError.style.display = 'none';
  body.appendChild(delError);

  const footer = document.createElement('div');
  footer.className = 'modal-footer';

  btnDelCancel = document.createElement('button');
  btnDelCancel.type = 'button';
  btnDelCancel.className = 'btn-secondary';
  btnDelCancel.textContent = 'Batal';
  btnDelCancel.addEventListener('click', closeDeleteModal);

  btnDelConfirm = document.createElement('button');
  btnDelConfirm.type = 'button';
  btnDelConfirm.className = 'btn-danger';
  btnDelConfirm.textContent = 'Hapus Permanen';

  footer.appendChild(btnDelCancel);
  footer.appendChild(btnDelConfirm);

  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(footer);
  delBackdrop.appendChild(card);

  delBackdrop.addEventListener('click', (e) => {
    if (e.target === delBackdrop) {
      closeDeleteModal();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (!delBackdrop || delBackdrop.classList.contains('hidden')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDeleteModal();
    }
  });

  document.body.appendChild(delBackdrop);
}

function closeDeleteModal() {
  if (delBackdrop) {
    delBackdrop.classList.add('hidden');
  }
  if (delError) {
    delError.textContent = '';
    delError.style.display = 'none';
  }
  if (currentDelResolve) {
    currentDelResolve(false);
    currentDelResolve = null;
  }
}

/**
 * Opens a confirmation modal to delete a file, folder, or batch of selected files.
 *
 * @param {{
 *   title?: string,
 *   message?: string,
 *   items: string[],
 *   confirmLabel?: string,
 *   onConfirm: () => Promise<boolean | void>,
 * }} opts
 * @returns {Promise<boolean>}
 */
export function openDeleteModal(opts) {
  ensureDeleteModalMounted();

  const {
    title = 'Konfirmasi Hapus',
    message = 'Item berikut akan dihapus permanen dari disk dan tidak dapat dibatalkan:',
    items = [],
    confirmLabel = 'Hapus Permanen',
    onConfirm,
  } = opts;

  return new Promise((resolve) => {
    currentDelResolve = resolve;

    delTitle.textContent = title;
    delDesc.textContent = message;
    delError.textContent = '';
    delError.style.display = 'none';

    delItemList.replaceChildren();
    items.forEach((itemText, idx) => {
      const row = document.createElement('div');
      row.className = 'delete-target-item';

      if (items.length > 1) {
        const num = document.createElement('span');
        num.className = 'delete-target-idx';
        num.textContent = String(idx + 1).padStart(2, '0');
        row.appendChild(num);
      }

      const code = document.createElement('code');
      code.className = 'delete-target-code';
      code.textContent = itemText;
      row.appendChild(code);

      delItemList.appendChild(row);
    });

    btnDelConfirm.disabled = false;
    btnDelConfirm.textContent = confirmLabel;

    const handleConfirm = async () => {
      btnDelConfirm.disabled = true;
      btnDelConfirm.textContent = 'Menghapus...';
      delError.style.display = 'none';

      try {
        const res = await onConfirm();
        if (res === false) {
          btnDelConfirm.disabled = false;
          btnDelConfirm.textContent = confirmLabel;
          return;
        }
        const finishResolve = currentDelResolve;
        currentDelResolve = null;
        closeDeleteModal();
        if (finishResolve) finishResolve(true);
      } catch (err) {
        delError.textContent = err.message || 'Gagal menghapus item.';
        delError.style.display = 'block';
        btnDelConfirm.disabled = false;
        btnDelConfirm.textContent = confirmLabel;
      }
    };

    btnDelConfirm.onclick = handleConfirm;

    delBackdrop.classList.remove('hidden');
    setTimeout(() => {
      btnDelConfirm.focus();
    }, 50);
  });
}


