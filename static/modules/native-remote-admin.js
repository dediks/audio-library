import { createSvgIcon } from './dom-icons.js';

// Local PC administration only. Never persist invitations or device tokens.
export function initNativeRemoteAdmin({
  document,
  renderQr,
  request = async payload => {
    const response = await fetch('/api/native-remote', payload ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    } : { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.code || 'connection_failed');
    return data;
  },
  bridgeRequest = async payload => {
    if (typeof fetch !== 'function') return null;
    const response = await fetch('/api/native-remote/wsl-bridge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || { action: 'status' }),
    });
    const data = await response.json();
    return { ok: response.ok && data.ok !== false, ...data };
  },
}) {
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
  let lastBridge = null;
  let portEdited = false;
  let defaultPortApplied = false;
  let wasEnabled = false;
  const rows = new Map();
  let busy = false;
  const errors = {
    invalid_bind: 'Masukkan IP LAN IPv4 privat yang terpasang di PC ini.',
    listener_unavailable: 'IP tidak tersedia atau port sedang dipakai. Tidak ada port pengganti otomatis.',
    wsl_port_reserved: 'Port ini dipakai oleh FOH Remote / Web UI di WSL2. Gunakan port 8767 untuk Android Remote.',
    local_origin_required: 'Buka pengaturan ini langsung dari aplikasi di PC.',
    device_limit: 'Batas perangkat sesi tercapai. Nonaktifkan lalu aktifkan untuk sesi baru.',
    disabled: 'Aktifkan HTTPS terlebih dahulu.',
    connection_failed: 'Koneksi ke aplikasi terputus. Status belum dapat dipastikan.',
  };
  const validInvite = info => Boolean(info?.enabled && info.invite && Number(info.invite_expires_at) > Date.now() / 1000);
  function currentEndpointPayload(action) {
    const bindIp = (el('nativeBindIp')?.value || '').trim();
    const portNum = Number(el('nativePort')?.value);
    const body = { action };
    if (bindIp) body.bind_ip = bindIp;
    if (Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535) body.port = portNum;
    return body;
  }
  function renderBridge(bridge, info) {
    lastBridge = bridge || lastBridge;
    const b = bridge || lastBridge;
    const box = el('nativeBridgeBox');
    const banner = el('nativeBridgeBanner');
    if (!b || (!b.is_wsl && !b.is_windows)) {
      if (box) box.classList.add('hidden');
      if (banner) banner.classList.add('hidden');
      return;
    }
    const portLabel = String(b.public_port || el('nativePort')?.value || '8767');
    const winIp = b.wifi_ip || el('nativeBindIp')?.value || 'Wi-Fi PC';
    let summaryText = '';
    if (b.port_conflict) {
      summaryText = `Port ${portLabel} dipakai oleh Web UI / FOH Remote WSL. Gunakan port ${info?.default_port || 8767}.`;
    } else if (b.needs_portproxy) {
      if (b.bridge_active && info?.enabled && b.tls_reachable) {
        summaryText = `Bridge & Firewall siap (${winIp}:${portLabel} → WSL2 127.0.0.1:${b.internal_port}), TLS terverifikasi.`;
      } else if (b.has_portproxy && b.firewall_active && !info?.enabled) {
        summaryText = `Bridge port ${portLabel} → ${b.internal_port} & Firewall siap. Klik 'Hubungkan Android' untuk mulai.`;
      } else if (b.has_portproxy && b.firewall_active && info?.enabled && b.tls_reachable === false) {
        summaryText = `Portproxy aktif, tetapi TLS belum merespons di ${winIp}:${portLabel}. Pastikan port tidak bentrok & coba 'Aktifkan Bridge & Firewall'.`;
      } else {
        const missing = [!b.has_portproxy && `portproxy (${portLabel} → 127.0.0.1:${b.internal_port})`, !b.firewall_active && `Firewall TCP ${portLabel}`].filter(Boolean).join(' + ');
        summaryText = `Perlu ${missing || 'bridge WSL2'} di Windows agar HP dapat menjangkau WSL2.`;
      }
    } else if (b.firewall_active) {
      summaryText = `Firewall Windows mengizinkan port TCP ${portLabel} (${winIp}).`;
    } else {
      summaryText = `Aturan Firewall Windows port ${portLabel} belum aktif. Jika HP gagal terhubung ('Desktop tidak dapat dijangkau'), izinkan port ini.`;
    }
    if (box) {
      box.classList.remove('hidden');
      if (el('nativeBridgeStatus')) el('nativeBridgeStatus').textContent = summaryText;
      if (el('nativeBridgeCmd')) el('nativeBridgeCmd').textContent = b.powershell_admin_cmd || '—';
      if (el('nativeBridgeEnable')) el('nativeBridgeEnable').textContent = b.needs_portproxy ? 'Aktifkan Bridge & Firewall (Admin)' : 'Izinkan Firewall Windows (Admin)';
      if (el('nativeBridgeDisable')) el('nativeBridgeDisable').classList.toggle('hidden', !(b.needs_portproxy && b.has_portproxy));
    }
    if (banner) {
      const showBanner = Boolean((b.needs_portproxy && (info?.enabled || !b.bridge_active)) || (!b.needs_portproxy && info?.enabled && !b.firewall_active));
      banner.classList.toggle('hidden', !showBanner);
      banner.classList.toggle('ready', Boolean(b.bridge_active && !b.port_conflict && (!info?.enabled || b.tls_reachable !== false)));
      if (el('nativeBridgeBannerTitle')) {
        el('nativeBridgeBannerTitle').textContent = b.port_conflict
          ? 'Konflik Port WSL2'
          : b.bridge_active
            ? (info?.enabled ? 'Jalur Windows → HP siap' : 'Bridge Windows siap')
            : (b.needs_portproxy ? 'Bridge Windows / Firewall belum aktif' : 'Firewall Windows mungkin memblokir HP');
      }
      if (el('nativeBridgeBannerText')) el('nativeBridgeBannerText').textContent = summaryText;
      if (el('nativeBridgeBannerEnable')) {
        el('nativeBridgeBannerEnable').classList.toggle('hidden', Boolean(b.bridge_active && !b.port_conflict));
        el('nativeBridgeBannerEnable').textContent = b.needs_portproxy ? 'Aktifkan Bridge & Firewall (Admin)' : 'Izinkan Firewall Windows (Admin)';
      }
    }
  }
  function render(info) {
    current = info;
    const show = (id, yes) => el(id).classList.toggle('hidden', !yes);
    show('nativeOff', !info.enabled);
    show('nativeDeviceSection', Boolean(info.enabled && info.devices?.length));
    show('nativeInviteOpen', Boolean(info.enabled));
    show('nativeInviteActions', Boolean(info.enabled));
    show('nativeStop', Boolean(info.enabled));
    el('nativeStatus').textContent = !info.enabled ? 'Belum aktif' : validInvite(info) ? 'Siap pairing' : 'Listener aktif · menunggu pairing';
    el('nativeConnection').textContent = info.url
      ? (info.bind_url ? `HP: ${info.url} · Listener WSL2: ${info.bind_url}` : info.url)
      : 'Listener belum aktif.';
    const previouslyEnabled = wasEnabled;
    wasEnabled = Boolean(info.enabled);
    if (info.enabled && info.url) {
      portEdited = false;
      defaultPortApplied = true;
      try {
        const endpoint = new URL(info.url);
        if (endpoint.protocol === 'https:') {
          el('nativeBindIp').value = endpoint.hostname;
          el('nativePort').value = endpoint.port || '443';
        }
      } catch (_) { /* Keep settings intact when the server has no valid endpoint. */ }
    } else if (!info.enabled) {
      if (info.default_bind_ip && !el('nativeBindIp').value && !previouslyEnabled) {
        el('nativeBindIp').value = info.default_bind_ip;
      }
      if (!defaultPortApplied && !portEdited && !previouslyEnabled && info.default_port) {
        el('nativePort').value = String(info.default_port);
        defaultPortApplied = true;
      }
    }
    const ipList = el('nativeIpList');
    if (ipList && Array.isArray(info.lan_ips) && el('nativeBindIp')) {
      ipList.replaceChildren();
      for (const ip of info.lan_ips) {
        const opt = document.createElement('option');
        opt.value = ip;
        ipList.appendChild(opt);
      }
    }
    if (lastBridge) renderBridge(lastBridge, info);
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
    for (const id of ['nativeBridgeEnable', 'nativeBridgeDisable', 'nativeBridgeCheck', 'nativeBridgeBannerEnable']) {
      if (el(id)) el(id).disabled = busy;
    }
    for (const { row } of rows.values()) for (const child of row.children) {
      if (child.tagName?.toLowerCase() === 'button' || child.tagName?.toLowerCase() === 'select') child.disabled = busy;
    }
  }
  async function checkBridge(action = 'status', announce = false) {
    if (!el('nativeBridgeBox') && !el('nativeBridgeBanner')) return;
    if (!current || (!current.is_wsl && !current.is_windows)) return;
    try {
      const res = await bridgeRequest(currentEndpointPayload(action));
      if (res && res.bridge) renderBridge(res.bridge, current);
      if (announce && res?.message) el('nativeFeedback').textContent = res.message;
      return res;
    } catch (_) {
      if (announce) el('nativeFeedback').textContent = 'Gagal memeriksa status bridge / firewall Windows.';
    }
  }
  async function runBridgeAction(action) {
    if (busy || !bridgeRequest) return;
    busy = true; revision++;
    lockControls();
    el('nativeFeedback').textContent = action === 'enable'
      ? 'Menunggu konfirmasi Admin Windows (UAC)…'
      : 'Memeriksa bridge Windows…';
    try {
      await checkBridge(action, true);
    } finally {
      busy = false;
      if (current) render(current);
      lockControls();
    }
  }
  async function refresh(options = {}) {
    const withBridge = Boolean(options?.checkBridge);
    if (current) render(current); // Deadline checks also run while a request is pending.
    if (busy) return;
    const version = revision;
    const sequence = ++pollSequence;
    try {
      const info = await request();
      if (version === revision && sequence === pollSequence && !busy) {
        render(info);
        if (withBridge || (!lastBridge && (info.is_wsl || info.is_windows))) {
          await checkBridge('status', false);
        }
      }
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
      if ((payload.action === 'start' || payload.action === 'stop') && (current?.is_wsl || current?.is_windows)) {
        await checkBridge('status', false);
      }
      el('nativeFeedback').textContent = '';
    } catch (error) {
      el('nativeFeedback').textContent = errors[error.message] || 'Operasi belum berhasil. Refresh untuk memeriksa status.';
    } finally {
      busy = false;
      if (current) render(current);
      lockControls();
    }
  }
  if (el('nativePort')) {
    el('nativePort').addEventListener('input', () => { portEdited = true; });
    el('nativePort').addEventListener('change', () => {
      if (!busy && !current?.enabled && (current?.is_wsl || current?.is_windows)) checkBridge('status', false);
    });
  }
  if (el('nativeBindIp')) {
    el('nativeBindIp').addEventListener('change', () => {
      if (!busy && !current?.enabled && (current?.is_wsl || current?.is_windows)) checkBridge('status', false);
    });
  }
  el('nativeGuide').addEventListener('click', () => { el('nativeSettings').open = true; });
  el('nativeShowCode').addEventListener('click', () => {
    el('nativeManual').open = !el('nativeManual').open;
    el('nativeShowCode').setAttribute('aria-expanded', String(el('nativeManual').open));
  });
  el('nativeStart').addEventListener('click', async () => {
    let bindIp = el('nativeBindIp').value.trim();
    if (!bindIp && current?.default_bind_ip) {
      bindIp = current.default_bind_ip;
      el('nativeBindIp').value = bindIp;
    }
    if (!bindIp) {
      el('nativeSettings').open = true;
      el('nativeBindIp').focus();
      el('nativeFeedback').textContent = 'Isi IP privat pada PC ini terlebih dahulu. Akses HP belum diperiksa.';
      return;
    }
    await act({ action: 'start', bind_ip: bindIp, port: Number(el('nativePort').value) });
  });
  for (const [id, action] of [['nativeStop', 'stop'], ['nativeInviteOpen', 'invite_open'], ['nativeInviteClose', 'invite_close']]) {
    el(id).addEventListener('click', () => act({ action }));
  }
  el('nativeRefresh').addEventListener('click', () => refresh({ checkBridge: true }));
  if (el('nativeBridgeEnable')) el('nativeBridgeEnable').addEventListener('click', () => runBridgeAction('enable'));
  if (el('nativeBridgeBannerEnable')) el('nativeBridgeBannerEnable').addEventListener('click', () => runBridgeAction('enable'));
  if (el('nativeBridgeDisable')) el('nativeBridgeDisable').addEventListener('click', () => runBridgeAction('disable'));
  if (el('nativeBridgeCheck')) el('nativeBridgeCheck').addEventListener('click', () => runBridgeAction('status'));
  if (el('nativeBridgeCopy')) el('nativeBridgeCopy').addEventListener('click', async () => {
    const cmd = el('nativeBridgeCmd')?.textContent || '';
    if (!cmd || cmd === '—') return;
    try {
      await navigator.clipboard.writeText(cmd);
      el('nativeFeedback').textContent = 'Perintah PowerShell tersalin. Jalankan di PowerShell (Run as Administrator).';
    } catch (_) {
      el('nativeFeedback').textContent = 'Clipboard tidak tersedia. Pilih dan salin perintah PowerShell secara manual.';
    }
  });
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
