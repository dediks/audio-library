// Run: node tests/native-player.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../static/modules/native-remote-player.js', import.meta.url), 'utf8');
const { createNativeCommandConsumer } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
let now = 1000;
let track = true;
let calls = 0;
const media = {
  paused: true, ended: false, readyState: 4, currentTime: 9, error: null,
  async play() { calls++; this.paused = false; },
  pause() { calls++; this.paused = true; },
};
const consumer = createNativeCommandConsumer({
  media: () => media, hasTrack: () => track, now: () => now, authorize: async () => true,
  execute: async action => {
    if (action === 'play') await media.play();
    else { media.pause(); if (action === 'stop') media.currentTime = 0; }
  },
});
const cmd = (id, action = 'play', expires_at = 1005) => ({ native_id: id, action, expires_at });
let ack = await consumer(cmd('first'));
assert.equal(ack.status, 'applied');
assert.equal(ack.observed.is_playing, true);
assert.equal(await consumer(cmd('first')), null, 'no re-execution on duplicate delivery');
assert.equal(calls, 1);
ack = await consumer(cmd('pause', 'pause'));
assert.equal(ack.status, 'applied');
assert.equal(ack.observed.is_playing, false);
ack = await consumer(cmd('stop', 'stop'));
assert.equal(ack.status, 'applied');
assert.equal(ack.observed.current_time, 0);
assert.equal(ack.observed.transport_state, 'STOPPED');
media.play = async () => { calls++; throw new Error('NotAllowedError'); };
ack = await consumer(cmd('rejected'));
assert.equal(ack.status, 'rejected', 'play promise rejection cannot be applied');
track = false;
const before = calls;
ack = await consumer(cmd('no-track'));
assert.equal(ack.status, 'rejected');
assert.equal(calls, before, 'must not auto-select another track');
track = true;
now = 1006;
ack = await consumer(cmd('expired'));
assert.equal(ack.status, 'expired');
assert.equal(calls, before, 'expired work must not touch the audio engine');
now = 1000;
media.play = async () => { calls++; /* promise resolves but playback did not start */ };
ack = await consumer(cmd('not-observed'));
assert.equal(ack.status, 'rejected');
media.paused = false;
media.readyState = 0;
ack = await consumer(cmd('no-media'));
assert.equal(ack.status, 'rejected', 'unready media cannot be applied');
console.log('PASS native player: observed play/pause/stop, rejection, no-track, TTL, dedup');

// Execute the actual polling function, not a source-string assertion.
const vm = await import('node:vm');
const player = fs.readFileSync(new URL('../static/player.js', import.meta.url), 'utf8');
const polling = player.slice(player.indexOf('  let isMasterSyncInFlight = false;'), player.indexOf('  function applyMasterStateToRemoteUI('));
const sent = [];
const claims = [];
const context = {
  apiPost: async (path, payload) => { claims.push({ path, payload }); return { ok: true, data: { authorized: true } }; },
  createNativeCommandConsumer, audioEl: media, activeTrackObj: {}, transportIntentVersion: 0,
  playCurrentTrack: async () => { media.paused = false; media.readyState = 4; },
  pauseCurrentTrack: () => media.pause(), stopAndResetCue: () => { media.pause(); media.currentTime = 0; },
  isRemoteController: false, isPageUnloading: false,
  buildMasterStateSnapshot: () => ({ is_playing: !media.paused }),
  btnOpenRemoteModal: null, remoteHeaderLabel: null, remoteModalClientCount: null, remoteModal: null,
  executeRemoteCommandOnMaster: () => {},
  fetch: async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ commands: sent.length === 1 ? [{ native_id: 'polling-one', action: 'play', expires_at: Date.now() / 1000 + 4 }] : [] }) };
  },
  setTimeout, clearTimeout, Date, console, crypto: { randomUUID: () => 'harness-master-instance' },
};
vm.createContext(context);
vm.runInContext(polling, context);
await vm.runInContext('pushMasterStateAndPollCommands()', context);
await vm.runInContext('pushMasterStateAndPollCommands()', context);
assert.equal(sent[1].native_acks?.[0]?.status, 'applied', 'actual localhost poll must carry observed native ack');
assert.equal(sent[1].native_acks[0].command_id, 'polling-one');
assert.equal(claims[0]?.path, '/api/native-remote/claim', 'real player must reauthorize delivery');
assert.equal(claims[0].payload.master_instance, 'harness-master-instance');
await vm.runInContext('pushMasterStateAndPollCommands()', context);
assert.equal(sent[2].native_acks.length, 0, 'delivered ack must be removed only after success');
console.log('PASS real player polling integration and ack handoff');
let checked = 0;
const blocked = createNativeCommandConsumer({
  media: () => media, hasTrack: () => true, now: () => 1000,
  authorize: async () => { checked++; return false; },
  execute: () => { throw new Error('revoked work must not execute'); },
});
assert.equal((await blocked(cmd('revoked-at-consumer'))).status, 'rejected');
assert.equal(checked, 1, 'permissions must be rechecked before actual execution');
console.log('PASS consumer permission recheck');
let unsafeCalls = 0;
const unconfigured = createNativeCommandConsumer({ media: () => media, hasTrack: () => true, now: () => 1000, execute: () => { unsafeCalls++; } });
assert.equal((await unconfigured(cmd('unconfigured'))).status, 'rejected');
assert.equal(unsafeCalls, 0, 'missing authorizer must fail closed');

// Real transport functions AND real native bridge: only browser/audio boundaries
// are faked. In particular, playCurrentTrack is never stubbed in these cases.
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function realTransportHarness({ delayFirstAuthorization = false } = {}) {
  const firstAuthorization = deferred();
  const enteredAuthorization = deferred();
  let authorizations = 0;
  const resume = deferred();
  const enteredResume = deferred();
  let plays = 0;
  let allowed = true;
  const badges = [];
  const audio = {
    paused: true, ended: false, readyState: 4, currentTime: 9, error: null,
    async play() { plays++; this.paused = false; },
    pause() { this.paused = true; },
    load() { this.paused = true; this.currentTime = 0; },
  };
  const ctx = {
    ...context,
    createNativeCommandConsumer: options => createNativeCommandConsumer({ ...options, now: () => 1000 }),
    audioEl: audio, activeTrackObj: { rel_path: 'cue.wav' },
    audioCtx: { state: 'suspended', resume() { enteredResume.resolve(); return resume.promise; } },
    cancelActiveFade() {}, ensureAudioGraph() {}, connectMediaElementToGraphIfReady() {},
    activeTrackRelPath: 'cue.wav', maxPeakHoldDb: -Infinity,
    persistWorkspaceState() {}, updatePeakBadge() {}, applyGainAndEqNodes() {}, updateNowPlayingCard() {},
    chkAutoTrim: null, preampSlider: null, seekSlider: null,
    buildStreamUrl: track => `/stream/${track.rel_path}`,
    requestRtaWake: null, pendingAutoResumeOnGesture: false,
    setTransportStateBadge: badge => badges.push(badge), syncPlayPauseButton() {},
    highlightActiveRowInTable() {}, renderCuePads() {}, savePlaybackSessionState() {}, updateTimecodeUI() {},
    notify: message => { throw new Error(`Unexpected notification: ${message.title}`); },
    apiPost: async () => {
      if (++authorizations === 1 && delayFirstAuthorization) {
        enteredAuthorization.resolve();
        await firstAuthorization.promise;
      }
      return { ok: true, data: { authorized: allowed } };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(player.slice(player.indexOf('  function loadTrack('), player.indexOf('  function triggerSmoothFadeOut(')) + '\n' + polling, ctx);
  return {
    audio, badges, resume, enteredResume, firstAuthorization, enteredAuthorization,
    get plays() { return plays; },
    revoke() { allowed = false; },
    native: (id, action = 'play', expiry = 1005) => vm.runInContext(`consumeNativeCommand(${JSON.stringify(cmd(id, action, expiry))})`, ctx),
    load: () => vm.runInContext("loadTrack({ rel_path: 'new-cue.wav' })", ctx),
    local: action => vm.runInContext(action === 'play' ? 'playCurrentTrack()' : action === 'pause' ? 'pauseCurrentTrack()' : 'stopAndResetCue()', ctx),
  };
}
const settleContinuations = () => new Promise(resolve => setImmediate(resolve));
{
  const h = realTransportHarness({ delayFirstAuthorization: true });
  const pending = h.native('first-authorization-local-stop');
  await h.enteredAuthorization.promise;
  h.local('stop');
  h.firstAuthorization.resolve();
  h.resume.resolve();
  assert.equal((await pending).status, 'rejected', 'first authorization must not let old native Play overtake local Stop');
  assert.equal(h.plays, 0);
  assert.equal(h.audio.paused, true);
  assert.equal(h.audio.currentTime, 0);
  assert.equal(h.badges.at(-1), 'CUED');
}
for (const origin of ['local', 'native']) {
  for (const action of ['stop', 'pause', 'play']) {
    const h = realTransportHarness({ delayFirstAuthorization: true });
    const pending = h.native(`first-auth-${origin}-${action}`);
    await h.enteredAuthorization.promise;
    const newer = origin === 'local' ? h.local(action) : h.native(`newer-${action}`, action);
    h.resume.resolve();
    const newerAck = await newer;
    if (origin === 'native') assert.equal(newerAck.status, 'applied');
    h.firstAuthorization.resolve();
    assert.equal((await pending).status, 'rejected', `first authorization must preserve newer ${origin} ${action}`);
    assert.equal(h.plays, action === 'play' ? 1 : 0);
    assert.equal(h.audio.paused, action !== 'play');
  }
}
{
  const h = realTransportHarness({ delayFirstAuthorization: true });
  const pending = h.native('first-auth-track-load');
  await h.enteredAuthorization.promise;
  h.load();
  h.firstAuthorization.resolve();
  h.resume.resolve();
  assert.equal((await pending).status, 'rejected', 'track load supersedes Play waiting for first authorization');
  assert.equal(h.plays, 0);
  assert.equal(h.audio.src, '/stream/new-cue.wav');
  assert.equal(h.audio.paused, true);
}
{
  const h = realTransportHarness({ delayFirstAuthorization: true });
  const pending = h.native('synchronous-arrival');
  h.local('stop'); // Before authorization even enters its first microtask.
  h.firstAuthorization.resolve();
  h.resume.resolve();
  assert.equal((await pending).status, 'rejected', 'reserve intent synchronously on native delivery');
  assert.equal(h.plays, 0);
}
console.log('PASS first authorization: local/native Stop/Pause/Play, actual track load, synchronous ordering');
{
  const h = realTransportHarness();
  const pending = h.native('expired-deferred', 'play', 1000.02);
  await h.enteredResume.promise;
  assert.equal((await pending).status, 'unknown', 'in-flight deadline remains honestly unknown');
  assert.equal(h.plays, 0);
  assert.equal((await h.native('new-stop', 'stop')).status, 'applied');
  h.resume.resolve();
  await settleContinuations();
  assert.equal(h.plays, 0, 'expired native Play must not start audio after deferred resume and newer Stop');
  assert.equal(h.audio.paused, true);
  assert.equal(h.audio.currentTime, 0);
  assert.equal(h.badges.at(-1), 'CUED');
}
for (const origin of ['local', 'native']) {
  for (const action of ['pause', 'stop']) {
    const h = realTransportHarness();
    const pending = h.native(`superseded-${origin}-${action}`);
    await h.enteredResume.promise;
    if (origin === 'local') h.local(action);
    else assert.equal((await h.native(`new-${action}`, action)).status, 'applied');
    h.resume.resolve();
    assert.equal((await pending).status, 'rejected');
    assert.equal(h.plays, 0, `new ${origin} ${action} must supersede native Play even before expiry`);
  }
}
{
  const h = realTransportHarness();
  const pending = h.native('expired-without-stop', 'play', 1000.02);
  await h.enteredResume.promise;
  assert.equal((await pending).status, 'unknown');
  h.resume.resolve();
  await settleContinuations();
  assert.equal(h.plays, 0, 'timeout cancels pending Play even without a newer transport action');
}
{
  const h = realTransportHarness();
  const pending = h.native('superseded-by-local-play');
  await h.enteredResume.promise;
  const newerPlay = h.local('play');
  h.resume.resolve();
  assert.equal((await pending).status, 'rejected');
  await newerPlay;
  assert.equal(h.plays, 1, 'only the newer local Play may start audio');
}
{
  const h = realTransportHarness();
  const pending = h.native('revoked-during-resume');
  await h.enteredResume.promise;
  h.revoke();
  h.resume.resolve();
  assert.equal((await pending).status, 'rejected');
  assert.equal(h.plays, 0, 'reauthorize after asynchronous audio preparation');
}
{
  const h = realTransportHarness();
  const pending = h.native('authorized-native');
  await h.enteredResume.promise;
  h.resume.resolve();
  assert.equal((await pending).status, 'applied');
  assert.equal(h.plays, 1, 'valid native Play still starts audio');
}
{
  const h = realTransportHarness();
  const pending = h.local('play');
  await h.enteredResume.promise;
  h.resume.resolve();
  await pending;
  assert.equal(h.plays, 1, 'ordinary local Play still resumes and starts audio');
  assert.equal(h.badges.at(-1), 'PLAYING');
}
console.log('PASS actual playCurrentTrack: deferred resume expiry, superseding intent, revocation, local playback');
