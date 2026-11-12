import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../static/modules/native-remote-admin.js', import.meta.url), 'utf8');
const { initNativeRemoteAdmin } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
class Element {
  textContent = ''; value = ''; disabled = false; children = []; listeners = {};
  classList = { add() {}, remove() {}, contains() { return false; } };
  set innerHTML(_) { throw new Error('unsafe innerHTML'); }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  appendChild(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
}
const html = fs.readFileSync(new URL('../static/player.html', import.meta.url), 'utf8');
const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], new Element()]));
const document = { getElementById: id => nodes.get(id), createElement: () => new Element() };
let state = { enabled: false, devices: [], protocol: 'v1' };
const sent = [];
const api = async payload => {
  sent.push(payload);
  if (payload?.action === 'start') state = { ...state, enabled: true, url: 'https://127.0.0.1:8766', fingerprint_sha256: 'ab'.repeat(32) };
  if (payload?.action === 'invite_open') state = { ...state, invite: 'test-fixture-not-a-real-invite', invite_expires_at: Date.now() / 1000 + 90 };
  if (payload?.action === 'invite_close') state = { ...state, invite: null };
  if (payload?.action === 'stop') state = { enabled: false, devices: [] };
  return state;
};
let qrText;
const admin = initNativeRemoteAdmin({ document, request: api, renderQr: (_canvas, text) => { qrText = text; return true; } });
assert.ok(nodes.has('nativeBindIp'), 'functional secure controls must live in the existing modal');
nodes.get('nativeBindIp').value = '127.0.0.1';
nodes.get('nativePort').value = '8766';
await nodes.get('nativeStart').listeners.click();
assert.equal(sent.at(-1).bind_ip, '127.0.0.1');
assert.equal(nodes.get('nativeStatus').textContent, 'Aktif · HTTPS v1');
await nodes.get('nativeInviteOpen').listeners.click();
assert.ok(qrText.startsWith('swararia1|'));
assert.ok(qrText.length <= 134, 'must fit the existing offline QR renderer');
assert.ok(!qrText.includes('?'), 'no credential-bearing URLs');
state.devices = [{ device_id: 'device-fixture', label: '<img onerror=evil()>', status: 'pending', role: null }];
await admin.refresh();
const row = nodes.get('nativeDevices').children[0];
assert.ok(row.children[0].textContent.includes('<img onerror=evil()>'));
await row.children.find(x => x.textContent === 'Izinkan kontrol').listeners.click();
assert.equal(sent.at(-1).action, 'approve');
assert.equal(sent.at(-1).role, 'control');
await nodes.get('nativeInviteClose').listeners.click();
assert.equal(nodes.get('nativePairing').value, '');
await nodes.get('nativeStop').listeners.click();
assert.equal(nodes.get('nativeStatus').textContent, 'Nonaktif');
console.log('PASS secure modal start/stop, local QR/manual invite, untrusted label, approval');
