import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const player = fs.readFileSync('static/player.js', 'utf8');
const html = fs.readFileSync('static/player.html', 'utf8');
assert.match(html, /id="btnOpenAndroidRemoteModal"/, 'Android needs a separate affordance');
assert.match(html, /id="remoteMasterSetupPanel"/);
assert.match(html, /id="remoteClientPinPanel"/);
const start = player.indexOf('  const androidRemoteModal =');
assert.ok(start > 0, 'native setup is separate from legacy browser setup');
const setup = player.slice(start, player.indexOf('  let lastRemoteBlockToastAt', start));
for (const remote of [true, false]) {
  let initialized = 0, refreshed = 0, timers = 0, cleared = 0;
  const nodes = new Map();
  for (const id of ['androidRemoteModal', 'btnOpenAndroidRemoteModal', 'btnCloseAndroidRemoteModal', 'btnCancelAndroidRemoteModal']) {
    nodes.set(id, { classList: { add() {}, remove() {} }, addEventListener(type, fn) { this[type] = fn; } });
  }
  const context = {
    document: { getElementById: id => nodes.get(id) }, isRemoteController: remote,
    initNativeRemoteAdmin: () => { initialized++; return { refresh() { refreshed++; } }; },
    renderQrToCanvas() {}, setInterval() { timers++; return 1; }, clearInterval() { cleared++; },
  };
  vm.runInNewContext(setup, context);
  if (remote) {
    assert.equal(initialized, 0, 'phone/simulator must not initialize native admin');
    assert.equal(nodes.get('btnOpenAndroidRemoteModal').click, undefined);
  } else {
    nodes.get('btnOpenAndroidRemoteModal').click();
    assert.equal(initialized, 1); assert.equal(refreshed, 1); assert.equal(timers, 1);
    nodes.get('btnCloseAndroidRemoteModal').click();
    assert.ok(cleared > 0);
  }
}
console.log('PASS dual remote: separate Android controls, local-only initialization, open/close timer');

// Run the real native initialization on an insecure HTTP browser controller.
const nativeInitStart = player.indexOf('  const nativeMasterInstance =');
const nativeInitEnd = player.indexOf('  async function pushMasterStateAndPollCommands', nativeInitStart);
assert.ok(nativeInitStart > 0 && nativeInitEnd > nativeInitStart);
const nativeInit = player.slice(nativeInitStart, nativeInitEnd);
const browserInitContext = {
  isRemoteController: true, crypto: {}, audioEl: null,
  createNativeCommandConsumer: () => () => {},
};
assert.doesNotThrow(() => vm.runInNewContext(`${nativeInit}\nglobalThis.initializationContinued = true;`, browserInitContext),
  'insecure HTTP browser initialization must not require crypto.randomUUID');
assert.equal(browserInitContext.initializationContinued, true);
let nativeUuidCalls = 0;
const nativeUuid = 'a4340cdd-8556-4b67-94af-f7101358ac79';
const nativeInitContext = {
  isRemoteController: false, audioEl: null,
  crypto: { randomUUID() { nativeUuidCalls++; return nativeUuid; } },
  createNativeCommandConsumer: () => () => {},
};
assert.equal(vm.runInNewContext(`${nativeInit}\nnativeMasterInstance;`, nativeInitContext), nativeUuid);
assert.equal(nativeUuidCalls, 1, 'native master retains one cryptographic identity initialization');
console.log('PASS native identity: insecure HTTP browser continues; local master uses crypto.randomUUID once');

// Exercise the actual legacy dispatcher against existing engine boundaries.
const dispatcher = player.slice(player.indexOf('  function executeRemoteCommandOnMaster('), player.indexOf('  let isMasterSyncInFlight'));
const called = [];
const slider = () => ({ value: '0' });
const context = {
  isRemoteController: false, audioEl: { paused: false, duration: 100, currentTime: 9 },
  volumeSlider: slider(), preampSlider: slider(), eqLowSlider: slider(), eqMidSlider: slider(), eqHighSlider: slider(),
  btnMute: { classList: { remove() {}, toggle() {} } }, isMuted: false,
  routingMode: 'stereo', routingButtons: [], chkAutoTrim: { checked: false },
  activeTrackObj: { rel_path: 'cue.wav' }, allFiles: [{ rel_path: 'cue.wav' }], cuePads: Array(8).fill({}),
  activePlaylist: '__ALL__', playlistSelectDropdown: slider(), maxPeakHoldDb: 0,
  getAdjacentTrack: direction => ({ direction }), computeRecommendedAutoTrimDb: () => -3,
};
for (const name of ['togglePlayPause', 'playCurrentTrack', 'pauseCurrentTrack', 'stopAndResetCue', 'loadTrack', 'triggerSmoothFadeOut', 'updateTimecodeUI', 'nudgeSeek', 'setPlayMode', 'applyGainAndEqNodes', 'savePlayerPrefs', 'ensureAudioGraph', 'applyRoutingMatrix', 'updateNowPlayingCard', 'updatePeakBadge', 'triggerCuePad', 'restartCuePadFromZero', 'saveCuePads', 'renderCuePads', 'assignFileToCuePad', 'renderPlaylists', 'applyFiltersAndRenderTable', 'persistWorkspaceState']) context[name] = (...args) => called.push([name, ...args]);
vm.createContext(context);
vm.runInContext(dispatcher, context);
const cases = {
  play: [{}, 'playCurrentTrack'], pause: [{}, 'pauseCurrentTrack'], stop: [{}, 'stopAndResetCue'],
  prev: [{}, 'loadTrack'], next: [{}, 'loadTrack'], fade: [{ duration: 5 }, 'triggerSmoothFadeOut'],
  seek_ratio: [{ ratio: .5 }, 'updateTimecodeUI'], nudge: [{ delta: 5 }, 'nudgeSeek'], cue_zero: [{}, 'updateTimecodeUI'],
  set_play_mode: [{ mode: 'loop' }, 'setPlayMode'], set_volume: [{ volume: 60 }, 'applyGainAndEqNodes'],
  toggle_mute: [{}, 'applyGainAndEqNodes'], set_preamp: [{ preamp_db: -3 }, 'applyGainAndEqNodes'],
  set_eq: [{ low_db: 2 }, 'applyGainAndEqNodes'], reset_eq: [{}, 'applyGainAndEqNodes'],
  set_routing: [{ mode: 'mono' }, 'applyRoutingMatrix'], set_autotrim: [{ enabled: true }, 'applyGainAndEqNodes'],
  reset_peak: [{}, 'updatePeakBadge'], trigger_pad: [{ index: 1 }, 'triggerCuePad'], restart_pad: [{ index: 1 }, 'restartCuePadFromZero'],
  clear_pad: [{ index: 1 }, 'saveCuePads'], assign_pad: [{ index: 1, rel_path: 'cue.wav' }, 'assignFileToCuePad'],
  load_track: [{ rel_path: 'cue.wav', auto_play: true }, 'loadTrack'], select_playlist: [{ playlist: 'set' }, 'renderPlaylists'],
  play_pause: [{}, 'pauseCurrentTrack'],
};
assert.equal(Object.keys(cases).length, 25);
for (const [action, [params, expected]] of Object.entries(cases)) {
  called.length = 0;
  context.executeRemoteCommandOnMaster({ action, params });
  assert.ok(called.some(([name]) => name === expected), `${action} reaches original engine function`);
}
assert.equal(context.volumeSlider.value, '60');
assert.equal(context.routingMode, 'mono');
assert.equal(context.playlistSelectDropdown.value, 'set');
console.log('PASS actual legacy dispatcher: all 25 browser actions reach original engine');
