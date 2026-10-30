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

/* ==========================================================================
   Safe DOM Batch Auto-Numbering & Tag Cleaner Modal Dialog
   ========================================================================== */

let batchRenBackdrop = null;
let batchRenTitle = null;
let batchRenModeSelect = null;
let batchRenStartInput = null;
let batchRenChkYtId = null;
let batchRenChkJunk = null;
let batchRenChkSpaces = null;
let batchRenSummary = null;
let batchRenPreviewList = null;
let batchRenError = null;
let btnBatchRenCancel = null;
let btnBatchRenApply = null;
let btnBatchRenClose = null;
let currentBatchRenResolve = null;

function ensureBatchRenameModalMounted() {
  if (batchRenBackdrop) return;

  batchRenBackdrop = document.createElement('div');
  batchRenBackdrop.className = 'modal-backdrop hidden';
  batchRenBackdrop.setAttribute('role', 'dialog');
  batchRenBackdrop.setAttribute('aria-modal', 'true');
  batchRenBackdrop.setAttribute('aria-labelledby', 'batchRenameModalTitle');

  const card = document.createElement('div');
  card.className = 'modal-card modal-batch-rename-card';

  const header = document.createElement('div');
  header.className = 'modal-header';

  batchRenTitle = document.createElement('h3');
  batchRenTitle.id = 'batchRenameModalTitle';
  batchRenTitle.textContent = '🔢 Auto-Number & Rapikan Nama Lagu';

  btnBatchRenClose = document.createElement('button');
  btnBatchRenClose.type = 'button';
  btnBatchRenClose.className = 'btn-text';
  btnBatchRenClose.textContent = '✕ Tutup';
  btnBatchRenClose.addEventListener('click', closeBatchRenameModal);

  header.appendChild(batchRenTitle);
  header.appendChild(btnBatchRenClose);

  const body = document.createElement('div');
  body.className = 'modal-body';

  // Top Controls Row: Numbering Mode + Start Number
  const controlsGrid = document.createElement('div');
  controlsGrid.className = 'batch-rename-controls-grid';

  const modeGroup = document.createElement('div');
  modeGroup.className = 'field-group compact-field';
  const modeLabel = document.createElement('label');
  modeLabel.className = 'field-label';
  modeLabel.htmlFor = 'batchRenModeSelect';
  modeLabel.textContent = 'Format Nomor Urut Track (Per Folder)';
  batchRenModeSelect = document.createElement('select');
  batchRenModeSelect.id = 'batchRenModeSelect';
  batchRenModeSelect.className = 'toolbar-select';
  [
    { val: 'dash', text: '01 - Judul Lagu (Rekomendasi FOH / CDJ)' },
    { val: 'dot', text: '01. Judul Lagu' },
    { val: 'strip', text: 'Hapus Nomor Urut Lama (Tanpa Nomor)' },
    { val: 'keep', text: 'Biarkan Nomor Urut Saat Ini' },
  ].forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.val;
    o.textContent = opt.text;
    batchRenModeSelect.appendChild(o);
  });
  modeGroup.appendChild(modeLabel);
  modeGroup.appendChild(batchRenModeSelect);

  const startGroup = document.createElement('div');
  startGroup.className = 'field-group compact-field';
  const startLabel = document.createElement('label');
  startLabel.className = 'field-label';
  startLabel.htmlFor = 'batchRenStartInput';
  startLabel.textContent = 'Mulai Nomor';
  batchRenStartInput = document.createElement('input');
  batchRenStartInput.type = 'number';
  batchRenStartInput.id = 'batchRenStartInput';
  batchRenStartInput.className = 'toolbar-input';
  batchRenStartInput.min = '1';
  batchRenStartInput.max = '999';
  batchRenStartInput.value = '1';
  startGroup.appendChild(startLabel);
  startGroup.appendChild(batchRenStartInput);

  controlsGrid.appendChild(modeGroup);
  controlsGrid.appendChild(startGroup);
  body.appendChild(controlsGrid);

  // Checkboxes for Tag Cleaning
  const checksWrap = document.createElement('div');
  checksWrap.className = 'batch-rename-checks';

  function createCheckOption(id, labelText, defaultChecked = true) {
    const lbl = document.createElement('label');
    lbl.className = 'batch-rename-check-item';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.id = id;
    chk.checked = defaultChecked;
    const span = document.createElement('span');
    span.textContent = labelText;
    lbl.appendChild(chk);
    lbl.appendChild(span);
    return { lbl, chk };
  }

  const c1 = createCheckOption(
    'batchRenChkYtId',
    'Hapus kode [ID YouTube 11-karakter] di buntut nama file',
    true
  );
  const c2 = createCheckOption(
    'batchRenChkJunk',
    'Hapus tag sampah ([Official Video], (Lyrics), [MV], (HD), (Full Album))',
    true
  );
  const c3 = createCheckOption(
    'batchRenChkSpaces',
    'Rapikan simbol pipa (｜), underscore (_), dan spasi berlebih',
    true
  );

  batchRenChkYtId = c1.chk;
  batchRenChkJunk = c2.chk;
  batchRenChkSpaces = c3.chk;

  checksWrap.appendChild(c1.lbl);
  checksWrap.appendChild(c2.lbl);
  checksWrap.appendChild(c3.lbl);
  body.appendChild(checksWrap);

  // Live Preview Header & List
  batchRenSummary = document.createElement('div');
  batchRenSummary.className = 'batch-rename-summary';
  batchRenSummary.textContent = 'Memuat preview perubahan nama...';
  body.appendChild(batchRenSummary);

  batchRenPreviewList = document.createElement('div');
  batchRenPreviewList.className = 'delete-target-list batch-rename-preview-list';
  body.appendChild(batchRenPreviewList);

  batchRenError = document.createElement('div');
  batchRenError.className = 'rename-error-msg';
  batchRenError.style.display = 'none';
  body.appendChild(batchRenError);

  const footer = document.createElement('div');
  footer.className = 'modal-footer';

  btnBatchRenCancel = document.createElement('button');
  btnBatchRenCancel.type = 'button';
  btnBatchRenCancel.className = 'btn-secondary';
  btnBatchRenCancel.textContent = 'Batal';
  btnBatchRenCancel.addEventListener('click', closeBatchRenameModal);

  btnBatchRenApply = document.createElement('button');
  btnBatchRenApply.type = 'button';
  btnBatchRenApply.className = 'btn-primary';
  btnBatchRenApply.textContent = 'Terapkan Batch Rename';

  footer.appendChild(btnBatchRenCancel);
  footer.appendChild(btnBatchRenApply);

  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(footer);
  batchRenBackdrop.appendChild(card);

  batchRenBackdrop.addEventListener('click', (e) => {
    if (e.target === batchRenBackdrop) {
      closeBatchRenameModal();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (!batchRenBackdrop || batchRenBackdrop.classList.contains('hidden')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeBatchRenameModal();
    }
  });

  document.body.appendChild(batchRenBackdrop);
}

function closeBatchRenameModal() {
  if (batchRenBackdrop) {
    batchRenBackdrop.classList.add('hidden');
  }
  if (batchRenError) {
    batchRenError.textContent = '';
    batchRenError.style.display = 'none';
  }
  if (currentBatchRenResolve) {
    currentBatchRenResolve(false);
    currentBatchRenResolve = null;
  }
}

/**
 * Opens the Batch Auto-Numbering & Tag Cleaner Modal with Live Preview.
 *
 * @param {{
 *   relPaths: string[],
 *   sourceDir?: string,
 *   apiPost: (url: string, body: any) => Promise<{ok: boolean, data: any, error?: string}>,
 *   onApplied?: (data: any) => Promise<void> | void,
 * }} opts
 * @returns {Promise<boolean>}
 */
export function openBatchRenameModal(opts) {
  ensureBatchRenameModalMounted();

  const { relPaths = [], sourceDir = '', apiPost, onApplied } = opts;

  return new Promise((resolve) => {
    currentBatchRenResolve = resolve;
    batchRenTitle.textContent = `🔢 Auto-Number & Rapikan Nama (${relPaths.length} Lagu)`;
    batchRenError.textContent = '';
    batchRenError.style.display = 'none';

    function collectOptions() {
      return {
        numbering_mode: batchRenModeSelect.value || 'dash',
        start_number: parseInt(batchRenStartInput.value, 10) || 1,
        strip_yt_id: Boolean(batchRenChkYtId.checked),
        strip_junk_tags: Boolean(batchRenChkJunk.checked),
        clean_spaces: Boolean(batchRenChkSpaces.checked),
      };
    }

    async function refreshPreview() {
      const options = collectOptions();
      batchRenStartInput.disabled = options.numbering_mode === 'strip' || options.numbering_mode === 'keep';
      batchRenSummary.textContent = 'Menghitung preview nama baru...';
      btnBatchRenApply.disabled = true;

      const { ok, data, error } = await apiPost('/api/batch-rename', {
        source_dir: sourceDir || '',
        rel_paths: relPaths,
        options,
        preview_only: true,
      });

      if (!ok) {
        batchRenError.textContent = error || 'Gagal memuat preview rename.';
        batchRenError.style.display = 'block';
        return;
      }

      batchRenError.style.display = 'none';
      const plan = data.plan || [];
      const changedCount = data.changed_count || 0;
      batchRenSummary.textContent =
        changedCount > 0
          ? `Live Preview: ${changedCount} dari ${plan.length} file akan diperbarui (penomoran direset per folder playlist)`
          : `Semua ${plan.length} file sudah sesuai dengan format yang dipilih (tidak ada perubahan).`;

      batchRenPreviewList.replaceChildren();
      plan.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'batch-rename-preview-item' + (item.changed ? ' is-changed' : ' is-unchanged');

        const idxBadge = document.createElement('span');
        idxBadge.className = 'delete-target-idx';
        idxBadge.textContent = String(idx + 1).padStart(2, '0');
        row.appendChild(idxBadge);

        const namesCol = document.createElement('div');
        namesCol.className = 'batch-rename-names-col';

        const oldLine = document.createElement('div');
        oldLine.className = 'batch-rename-old';
        oldLine.textContent = (item.folder ? `[${item.folder}] ` : '') + item.old_name;

        const newLine = document.createElement('div');
        newLine.className = 'batch-rename-new';
        newLine.textContent = '→ ' + item.new_name;

        namesCol.appendChild(oldLine);
        namesCol.appendChild(newLine);
        row.appendChild(namesCol);

        batchRenPreviewList.appendChild(row);
      });

      btnBatchRenApply.disabled = changedCount === 0;
      btnBatchRenApply.textContent =
        changedCount > 0 ? `Terapkan Rename (${changedCount} File)` : 'Tidak Ada Perubahan';
    }

    batchRenModeSelect.onchange = refreshPreview;
    batchRenStartInput.oninput = refreshPreview;
    batchRenChkYtId.onchange = refreshPreview;
    batchRenChkJunk.onchange = refreshPreview;
    batchRenChkSpaces.onchange = refreshPreview;

    btnBatchRenApply.onclick = async () => {
      btnBatchRenApply.disabled = true;
      btnBatchRenApply.textContent = 'Menerapkan...';
      batchRenError.style.display = 'none';

      const { ok, data, error } = await apiPost('/api/batch-rename', {
        source_dir: sourceDir || '',
        rel_paths: relPaths,
        options: collectOptions(),
        preview_only: false,
      });

      if (!ok) {
        batchRenError.textContent = error || 'Gagal menerapkan batch rename.';
        batchRenError.style.display = 'block';
        btnBatchRenApply.disabled = false;
        btnBatchRenApply.textContent = 'Terapkan Batch Rename';
        return;
      }

      if (typeof onApplied === 'function') {
        await onApplied(data);
      }

      const finishResolve = currentBatchRenResolve;
      currentBatchRenResolve = null;
      closeBatchRenameModal();
      if (finishResolve) finishResolve(true);
    };

    batchRenBackdrop.classList.remove('hidden');
    refreshPreview();
  });
}



