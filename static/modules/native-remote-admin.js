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
  let current;
  let signature = '';
  let busy = false;
  const errors = {
    invalid_bind: 'Masukkan IP LAN IPv4 privat yang terpasang di PC ini.',
    listener_unavailable: 'IP tidak tersedia atau port sedang dipakai. Tidak ada port pengganti otomatis.',
    local_origin_required: 'Buka pengaturan ini langsung dari aplikasi di PC.',
    device_limit: 'Batas perangkat sesi tercapai. Nonaktifkan lalu aktifkan untuk sesi baru.',
    disabled: 'Aktifkan HTTPS terlebih dahulu.',
    connection_failed: 'Koneksi ke aplikasi terputus. Status belum dapat dipastikan.',
  };
  function render(info) {
    current = info;
    el('nativeStatus').textContent = info.enabled ? 'Aktif · HTTPS v1' : 'Nonaktif';
    el('nativeConnection').textContent = info.url || 'Listener belum aktif.';
    el('nativeFingerprint').textContent = info.fingerprint_sha256 || '—';
    el('nativeStart').disabled = Boolean(info.enabled);
    el('nativeStop').disabled = !info.enabled;
    el('nativeBindIp').disabled = Boolean(info.enabled);
    el('nativePort').disabled = Boolean(info.enabled);
    el('nativeInviteOpen').disabled = !info.enabled;
    el('nativeInviteClose').disabled = !info.invite;
    let pairing = '';
    if (info.invite && info.url && /^[0-9a-f]{64}$/.test(info.fingerprint_sha256)) {
      const bytes = info.fingerprint_sha256.match(/../g).map(x => String.fromCharCode(parseInt(x, 16))).join('');
      const fingerprint = btoa(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      pairing = `swararia1|${new URL(info.url).host}|${fingerprint}|${info.invite}`;
    }
    el('nativePairing').value = pairing;
    el('nativeCopy').disabled = !pairing;
    el('nativeQr').classList.add('hidden');
    if (pairing) {
      const drawn = renderQr && renderQr(el('nativeQr'), pairing, { sizePx: 180, margin: 3 });
      if (drawn) el('nativeQr').classList.remove('hidden');
      el('nativeInviteStatus').textContent = drawn
        ? 'Invite sekali pakai · berlaku 90 detik. Cocokkan fingerprint di PC sebelum pairing.'
        : 'QR tidak tersedia. Salin pairing string manual dan cocokkan fingerprint di PC.';
    } else {
      el('nativeInviteStatus').textContent = 'Invite tertutup atau sudah dipakai/kedaluwarsa.';
    }
    const devices = Array.isArray(info.devices) ? info.devices : [];
    const nextSignature = JSON.stringify(devices);
    if (nextSignature === signature) return;
    signature = nextSignature;
    const list = el('nativeDevices');
    list.replaceChildren();
    if (!devices.length) {
      const empty = document.createElement('p');
      empty.textContent = 'Belum ada perangkat pada sesi ini.';
      list.appendChild(empty);
    }
    for (const d of devices) {
      const row = document.createElement('div');
      row.className = 'remote-client-item';
      const label = document.createElement('span');
      label.textContent = `${d.label} · ${d.status}${d.role ? ' · ' + d.role : ''}`;
      row.appendChild(label);
      const button = (text, payload) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn-nudge'; b.textContent = text;
        b.addEventListener('click', () => act(payload));
        row.appendChild(b);
      };
      if (d.status === 'pending') {
        button('Izinkan kontrol', { action: 'approve', device_id: d.device_id, role: 'control' });
        button('Pantau saja', { action: 'approve', device_id: d.device_id, role: 'view_only' });
        button('Tolak', { action: 'deny', device_id: d.device_id });
      } else if (d.status === 'active') {
        button(d.role === 'control' ? 'Pantau saja' : 'Izinkan kontrol', {
          action: 'approve', device_id: d.device_id, role: d.role === 'control' ? 'view_only' : 'control',
        });
        button('Putus akses', { action: 'revoke', device_id: d.device_id });
      }
      list.appendChild(row);
    }
  }
  async function act(payload) {
    if (busy) return;
    busy = true;
    el('nativeFeedback').textContent = 'Memproses…';
    try {
      render(await request(payload));
      el('nativeFeedback').textContent = '';
    } catch (error) {
      el('nativeFeedback').textContent = errors[error.message] || 'Operasi belum berhasil. Refresh untuk memeriksa status.';
    } finally {
      busy = false;
    }
  }
  el('nativeStart').addEventListener('click', () => act({ action: 'start', bind_ip: el('nativeBindIp').value.trim(), port: Number(el('nativePort').value) }));
  for (const [id, action] of [['nativeStop', 'stop'], ['nativeInviteOpen', 'invite_open'], ['nativeInviteClose', 'invite_close']]) {
    el(id).addEventListener('click', () => act({ action }));
  }
  el('nativeRefresh').addEventListener('click', () => act());
  el('nativeCopy').addEventListener('click', async () => {
    if (!current?.invite) return;
    try {
      await navigator.clipboard.writeText(el('nativePairing').value);
      el('nativeFeedback').textContent = 'Pairing string tersalin. Jangan bagikan ke pihak lain.';
    } catch (_) {
      el('nativeFeedback').textContent = 'Clipboard tidak tersedia. Pilih dan salin pairing string manual.';
    }
  });
  return { refresh: () => act() };
}
