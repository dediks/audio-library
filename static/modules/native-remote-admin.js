import { createSvgIcon } from './dom-icons.js';

// Local PC administration only. Never persist invitations or device tokens.
export function initNativeRemoteAdmin({ document, renderQr, request = async payload => {
  const response = await fetch('/api/native-remote', payload ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  } : { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.code || 'connection_failed');
  return data;
} }) {
  const el = id => document.getElementById(id);
  const shapes = {
    phone: [{ tag: 'rect', attrs: { x: '6', y: '2', width: '12', height: '20', rx: '2' } }, { tag: 'line', attrs: { x1: '10', y1: '18', x2: '14', y2: '18' } }],
    link: [{ tag: 'path', attrs: { d: 'M10 13a5 5 0 007 .5l3-3a5 5 0 00-7-7l-2 2M14 11a5 5 0 00-7-.5l-3 3a5 5 0 007 7l2-2' } }],
    settings: [{ tag: 'path', attrs: { d: 'M4 7h16M4 17h16' } }, { tag: 'circle', attrs: { cx: '9', cy: '7', r: '3', fill: 'var(--bg-surface)' } }, { tag: 'circle', attrs: { cx: '15', cy: '17', r: '3', fill: 'var(--bg-surface)' } }],
  };
  for (const [id, name] of [['nativeTitleIcon', 'phone'], ['nativeHeroIcon', 'phone'], ['nativeStart', 'link'], ['nativeSettingsIcon', 'settings']]) {
    el(id).appendChild(createSvgIcon(shapes[name], { 'aria-hidden': 'true', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }
  let current;
  const rows = new Map();
  let busy = false;
  const errors = {
    invalid_bind: 'Masukkan IP LAN IPv4 privat yang terpasang di PC ini.',
    listener_unavailable: 'IP tidak tersedia atau port sedang dipakai. Tidak ada port pengganti otomatis.',
    local_origin_required: 'Buka pengaturan ini langsung dari aplikasi di PC.',
    device_limit: 'Batas perangkat sesi tercapai. Nonaktifkan lalu aktifkan untuk sesi baru.',
    disabled: 'Aktifkan HTTPS terlebih dahulu.',
    connection_failed: 'Koneksi ke aplikasi terputus. Status belum dapat dipastikan.',
  };
  const validInvite = info => Boolean(info?.enabled && info.invite && Number(info.invite_expires_at) > Date.now() / 1000);
  function render(info) {
    current = info;
    const show = (id, yes) => el(id).classList.toggle('hidden', !yes);
    show('nativeOff', !info.enabled);
    show('nativeDeviceSection', Boolean(info.enabled && info.devices?.length));
    show('nativeInviteOpen', Boolean(info.enabled));
    show('nativeInviteActions', Boolean(info.enabled));
    show('nativeStop', Boolean(info.enabled));
    el('nativeStatus').textContent = !info.enabled ? 'Belum aktif' : validInvite(info) ? 'Siap pairing' : 'Listener aktif · menunggu pairing';
    el('nativeConnection').textContent = info.url || 'Listener belum aktif.';
    if (info.enabled && info.url) {
      try {
        const endpoint = new URL(info.url);
        if (endpoint.protocol === 'https:') {
          el('nativeBindIp').value = endpoint.hostname;
          el('nativePort').value = endpoint.port || '443';
        }
      } catch (_) { /* Keep settings intact when the server has no valid endpoint. */ }
    }
    el('nativeFingerprint').textContent = info.fingerprint_sha256 || '—';
    el('nativeStart').disabled = Boolean(info.enabled);
    el('nativeStop').disabled = !info.enabled;
    el('nativeBindIp').disabled = Boolean(info.enabled);
    el('nativePort').disabled = Boolean(info.enabled);
    el('nativeInviteOpen').disabled = !info.enabled;
    el('nativeInviteClose').disabled = !validInvite(info);
    const seconds = Math.max(0, Math.ceil((Number(info.invite_expires_at) || 0) - Date.now() / 1000));
    el('nativeCountdown').textContent = validInvite(info) ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : '';
    let pairing = '';
    if (validInvite(info) && info.url && /^[0-9a-f]{64}$/.test(info.fingerprint_sha256)) {
      const bytes = info.fingerprint_sha256.match(/../g).map(x => String.fromCharCode(parseInt(x, 16))).join('');
      const fingerprint = btoa(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      try {
        const url = new URL(info.url);
        if (url.protocol === 'https:' && url.host) pairing = `swararia1|${url.host}|${fingerprint}|${info.invite}`;
      } catch (_) { /* Missing/invalid endpoint is not a ready invitation. */ }
    }
    if (info.enabled && !pairing) el('nativeStatus').textContent = 'Listener aktif · menunggu pairing';
    el('nativePairing').value = pairing;
    el('nativeCopy').disabled = !pairing;
    el('nativeQr').classList.add('hidden');
    if (pairing) {
      const drawn = renderQr && renderQr(el('nativeQr'), pairing, { sizePx: 180, margin: 3 });
      if (drawn) el('nativeQr').classList.remove('hidden');
      el('nativeInviteStatus').textContent = drawn
        ? 'Kode sekali pakai · jangan dibagikan. Cocokkan fingerprint di PC sebelum pairing.'
        : 'QR tidak tersedia. Salin pairing string manual dan cocokkan fingerprint di PC.';
    } else {
      el('nativeInviteStatus').textContent = 'Invite tertutup atau sudah dipakai/kedaluwarsa.';
    }
    show('nativeQrCard', Boolean(pairing && !el('nativeQr').classList.contains('hidden')));
    show('nativePairingPanel', Boolean(pairing));
    show('nativeInviteClose', Boolean(pairing));
    el('nativeShowCode').setAttribute('aria-expanded', String(el('nativeManual').open));
    el('nativeInviteOpen').textContent = pairing ? 'Buat kode baru' : 'Buat kode pairing';
    const devices = liveDevices(info);
    show('nativeInviteStatus', Boolean(info.enabled && !devices.length && (!pairing || el('nativeQr').classList.contains('hidden'))));
    const pending = devices.filter(d => d.status === 'pending').length;
    const active = devices.length - pending;
    show('nativeDeviceSection', devices.length > 0);
    if (pending) el('nativeStatus').textContent = `Butuh persetujuan · ${pending}`;
    else if (active) el('nativeStatus').textContent = `${active} perangkat terhubung`;
    el('nativeStatusDot').style.background = pending ? 'var(--accent-amber)' : active ? 'var(--accent-green)' : pairing ? 'var(--accent-cyan)' : 'var(--text-muted)';
    el('nativeDeviceTitle').textContent = pending ? 'Izinkan perangkat yang kamu kenali' : 'Perangkat terhubung';
    if (active && !pairing) el('nativeInviteOpen').textContent = 'Hubungkan perangkat lain';
    const list = el('nativeDevices');
    const ids = new Set(devices.map(d => d.device_id));
    for (const [id, record] of rows) if (!ids.has(id)) { record.row.remove(); rows.delete(id); }
    for (const d of devices) {
      let record = rows.get(d.device_id);
      if (!record || record.status !== d.status) {
        if (record) record.row.remove();
        const row = document.createElement('div');
        row.className = `remote-client-item native-device native-${d.status}`; row.dataset.deviceId = d.device_id;
        const label = document.createElement('span'); label.className = 'remote-client-name'; row.appendChild(label);
        const meta = document.createElement('span'); meta.className = 'remote-client-meta'; row.appendChild(meta);
        const icon = document.createElement('span'); icon.className = 'native-device-icon';
        icon.appendChild(createSvgIcon(shapes.phone, { 'aria-hidden': 'true' })); row.appendChild(icon);
        const button = (text, action, role, className) => {
          const b = document.createElement('button'); b.type = 'button'; b.className = className; b.textContent = text;
          b.addEventListener('click', () => deviceAction(d.device_id, d.status, action, role)); row.appendChild(b);
        };
        let select;
        if (d.status === 'pending') {
          button('Izinkan kontrol', 'approve', 'control', 'btn-accent');
          button('Pantau saja', 'approve', 'view_only', 'btn-secondary');
          button('Tolak', 'deny', undefined, 'btn-text native-danger');
        } else {
          select = document.createElement('select'); select.className = 'toolbar-input'; select.setAttribute('aria-label', 'Izin perangkat');
          for (const [value, title] of [['control', 'Kontrol penuh'], ['view_only', 'Pantau saja']]) {
            const option = document.createElement('option'); option.value = value; option.textContent = title; select.appendChild(option);
          }
          select.addEventListener('change', () => { const role = select.value; select.value = rows.get(d.device_id)?.role || d.role; return deviceAction(d.device_id, 'active', 'approve', role); });
          row.appendChild(select);
          button('Putus akses', 'revoke', undefined, 'btn-client-kick');
        }
        record = { row, label, meta, select, status: d.status }; rows.set(d.device_id, record); list.appendChild(row);
      }
      record.label.textContent = d.label;
      record.role = d.role;
      record.meta.textContent = d.status === 'pending' ? 'Meminta akses ke pemutar PC' : d.role === 'control' ? 'Kontrol penuh' : 'Pantau saja';
      if (record.select) record.select.value = d.role;
    }
    lockControls();
  }
  function liveDevices(info) {
    return info?.enabled && Array.isArray(info.devices) ? info.devices.filter(d => ['pending', 'active'].includes(d.status) && Number(d.expires_at) > Date.now() / 1000) : [];
  }
  function deviceAction(id, status, action, role) {
    if (!liveDevices(current).some(d => d.device_id === id && d.status === status)) { if (current) render(current); return; }
    return act({ action, device_id: id, ...(role ? { role } : {}) });
  }
  let revision = 0;
  let pollSequence = 0;
  function lockControls() {
    for (const [id, disabled] of [
      ['nativeStart', !current || current.enabled], ['nativeStop', !current?.enabled],
      ['nativeBindIp', current?.enabled], ['nativePort', current?.enabled],
      ['nativeInviteOpen', !current?.enabled], ['nativeInviteClose', !validInvite(current)],
      ['nativeCopy', !validInvite(current) || !el('nativePairing').value], ['nativeRefresh', false],
    ]) el(id).disabled = busy || Boolean(disabled);
    for (const { row } of rows.values()) for (const child of row.children) {
      if (child.tagName?.toLowerCase() === 'button' || child.tagName?.toLowerCase() === 'select') child.disabled = busy;
    }
  }
  async function refresh() {
    if (current) render(current); // Deadline checks also run while a request is pending.
    if (busy) return;
    const version = revision;
    const sequence = ++pollSequence;
    try {
      const info = await request();
      if (version === revision && sequence === pollSequence && !busy) render(info);
    } catch (error) {
      if (version === revision && sequence === pollSequence && !busy) {
        el('nativeFeedback').textContent = errors[error.message] || errors.connection_failed;
      }
    }
  }
  async function act(payload) {
    if (busy) return;
    busy = true; revision++;
    lockControls();
    el('nativeFeedback').textContent = 'Memproses…';
    try {
      render(await request(payload));
      if (payload.action === 'start' && current.enabled && !validInvite(current)) render(await request({ action: 'invite_open' }));
      el('nativeFeedback').textContent = '';
    } catch (error) {
      el('nativeFeedback').textContent = errors[error.message] || 'Operasi belum berhasil. Refresh untuk memeriksa status.';
    } finally {
      busy = false;
      if (current) render(current);
      lockControls();
    }
  }
  el('nativeGuide').addEventListener('click', () => { el('nativeSettings').open = true; });
  el('nativeShowCode').addEventListener('click', () => {
    el('nativeManual').open = !el('nativeManual').open;
    el('nativeShowCode').setAttribute('aria-expanded', String(el('nativeManual').open));
  });
  el('nativeStart').addEventListener('click', async () => {
    if (!el('nativeBindIp').value.trim()) {
      el('nativeSettings').open = true;
      el('nativeBindIp').focus();
      el('nativeFeedback').textContent = 'Isi IP privat pada PC ini terlebih dahulu. Akses HP belum diperiksa.';
      return;
    }
    await act({ action: 'start', bind_ip: el('nativeBindIp').value.trim(), port: Number(el('nativePort').value) });
  });
  for (const [id, action] of [['nativeStop', 'stop'], ['nativeInviteOpen', 'invite_open'], ['nativeInviteClose', 'invite_close']]) {
    el(id).addEventListener('click', () => act({ action }));
  }
  el('nativeRefresh').addEventListener('click', refresh);
  el('nativeCopy').addEventListener('click', async () => {
    if (busy) return;
    if (!validInvite(current)) { if (current) render(current); return; }
    try {
      await navigator.clipboard.writeText(el('nativePairing').value);
      el('nativeFeedback').textContent = 'Pairing string tersalin. Jangan bagikan ke pihak lain.';
    } catch (_) {
      el('nativeManual').open = true;
      el('nativeShowCode').setAttribute('aria-expanded', 'true');
      el('nativePairing').focus(); el('nativePairing').select();
      el('nativeFeedback').textContent = 'Clipboard tidak tersedia. Pilih dan salin pairing string manual.';
    }
  });
  return { refresh };
}
