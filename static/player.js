/**
 * SWARARIA AUDIO LAB - Stage 7: FOH Live Player, Soundcheck RTA & Instant Cue Deck
 * Engineered for Soundmen, FOH Operators & Event Playback Technicians.
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
  createSpectralBadge,
  openFolderInExplorer,
  getSharedWorkspaceState,
  saveSharedWorkspaceState,
} from './modules/ui-shared.js';
import { initFolderModal } from './modules/folder-modal.js';
import { renderQrToCanvas } from './modules/qr-code.js';

const CUE_PADS_STORAGE_KEY = 'swararia_foh_cue_pads_v1';
const PLAYER_PREFS_STORAGE_KEY = 'swararia_foh_player_prefs_v1';
const PLAYBACK_SESSION_STORAGE_KEY = 'swararia_foh_playback_session_v1';
const REMOTE_PIN_STORAGE_KEY = 'swararia_foh_remote_pin_v1';
const REMOTE_CLIENT_ID_KEY = 'swararia_foh_remote_cid_v1';

document.addEventListener('DOMContentLoaded', () => {
  initAppHeader({ activePage: 'player' });

  // DOM References - Transport & Now Playing
  const audioEl = document.getElementById('fohAudioElement');
  const playerStateBadge = document.getElementById('playerStateBadge');
  const activePlayModeBadge = document.getElementById('activePlayModeBadge');
  const nowPlayingIndex = document.getElementById('nowPlayingIndex');
  const nowPlayingTitle = document.getElementById('nowPlayingTitle');
  const nowPlayingMetaRow = document.getElementById('nowPlayingMetaRow');
  const nowPlayingQcBanner = document.getElementById('nowPlayingQcBanner');
  const nowPlayingQcText = document.getElementById('nowPlayingQcText');

  const timeElapsed = document.getElementById('timeElapsed');
  const timeRemaining = document.getElementById('timeRemaining');
  const timeDuration = document.getElementById('timeDuration');
  const countdownBox = document.getElementById('countdownBox');

  const seekSlider = document.getElementById('seekSlider');
  const btnCueZero = document.getElementById('btnCueZero');
  const btnSeekBack10 = document.getElementById('btnSeekBack10');
  const btnSeekBack5 = document.getElementById('btnSeekBack5');
  const btnSeekFwd5 = document.getElementById('btnSeekFwd5');
  const btnSeekFwd10 = document.getElementById('btnSeekFwd10');
  const nextCueHint = document.getElementById('nextCueHint');

  const btnPrevTrack = document.getElementById('btnPrevTrack');
  const btnPlayPause = document.getElementById('btnPlayPause');
  const btnPlayPauseText = document.getElementById('btnPlayPauseText');
  const btnStopReset = document.getElementById('btnStopReset');
  const btnNextTrack = document.getElementById('btnNextTrack');
  const btnFadeOut3 = document.getElementById('btnFadeOut3');
  const btnFadeOut5 = document.getElementById('btnFadeOut5');

  const modeBtnCue = document.getElementById('modeBtnCue');
  const modeBtnContinuous = document.getElementById('modeBtnContinuous');
  const modeBtnLoop = document.getElementById('modeBtnLoop');

  // DOM References - RTA, Matrix, Gain & EQ
  const rtaCanvas = document.getElementById('rtaCanvas');
  const meterPeakText = document.getElementById('meterPeakText');
  const btnResetPeak = document.getElementById('btnResetPeak');
  const routingStatusLabel = document.getElementById('routingStatusLabel');
  const routingButtons = Array.from(document.querySelectorAll('.btn-route'));

  const volumeSlider = document.getElementById('volumeSlider');
  const volumeValText = document.getElementById('volumeValText');
  const btnMute = document.getElementById('btnMute');
  const preampSlider = document.getElementById('preampSlider');
  const preampValText = document.getElementById('preampValText');
  const btnResetPreamp = document.getElementById('btnResetPreamp');

  const eqLowSlider = document.getElementById('eqLowSlider');
  const eqLowVal = document.getElementById('eqLowVal');
  const eqMidSlider = document.getElementById('eqMidSlider');
  const eqMidVal = document.getElementById('eqMidVal');
  const eqHighSlider = document.getElementById('eqHighSlider');
  const eqHighVal = document.getElementById('eqHighVal');
  const btnResetEq = document.getElementById('btnResetEq');

  const chkAutoTrim = document.getElementById('chkAutoTrim');
  const outputDeviceSelect = document.getElementById('outputDeviceSelect');
  const btnRefreshDevices = document.getElementById('btnRefreshDevices');

  const eqTabBadge = document.getElementById('eqTabBadge');
  const outputTabBadge = document.getElementById('outputTabBadge');
  const dspRackBody = document.getElementById('dspRackBody');
  const dspRackTabs = Array.from(document.querySelectorAll('.dsp-rack-tab'));
  const dspRackPanes = Array.from(document.querySelectorAll('.dsp-rack-pane'));

  // DOM References - Cue Pads & Setlist Table
  const cuePadsGrid = document.getElementById('cuePadsGrid');
  const cuePadsBody = document.getElementById('cuePadsBody');
  const cuePadsCountBadge = document.getElementById('cuePadsCountBadge');
  const btnAssignCurrentToPad = document.getElementById('btnAssignCurrentToPad');
  const btnAssignCurrentText = document.getElementById('btnAssignCurrentText');
  const btnClearAllPads = document.getElementById('btnClearAllPads');
  const btnToggleCuePads = document.getElementById('btnToggleCuePads');
  const btnToggleCuePadsText = document.getElementById('btnToggleCuePadsText');

  const padPickerModal = document.getElementById('padPickerModal');
  const padPickerModalTitle = document.getElementById('padPickerModalTitle');
  const btnClosePadPicker = document.getElementById('btnClosePadPicker');
  const btnCancelPadPicker = document.getElementById('btnCancelPadPicker');
  const padPickerActiveBanner = document.getElementById('padPickerActiveBanner');
  const padPickerActiveTitle = document.getElementById('padPickerActiveTitle');
  const btnPickActiveDeckTrack = document.getElementById('btnPickActiveDeckTrack');
  const padPickerSearchInput = document.getElementById('padPickerSearchInput');
  const padPickerList = document.getElementById('padPickerList');

  const btnOpenExplorer = document.getElementById('btnOpenExplorer');
  const btnQuickAuditSetlist = document.getElementById('btnQuickAuditSetlist');
  const btnQuickAuditText = document.getElementById('btnQuickAuditText');
  const activeSourceBadge = document.getElementById('activeSourceBadge');
  const sourceDirInput = document.getElementById('sourceDirInput');
  const playerCountSummary = document.getElementById('playerCountSummary');
  const btnBrowseSource = document.getElementById('btnBrowseSource');
  const btnResetInbox = document.getElementById('btnResetInbox');
  const playlistGrid = document.getElementById('playlistGrid');
  const playlistSelectDropdown = document.getElementById('playlistSelectDropdown');

  const searchInput = document.getElementById('searchInput');
  const groupByMode = document.getElementById('groupByMode');
  const filterQcStatus = document.getElementById('filterQcStatus');
  const filterFormat = document.getElementById('filterFormat');
  const btnCollapseAllGroups = document.getElementById('btnCollapseAllGroups');
  const btnExpandAllGroups = document.getElementById('btnExpandAllGroups');
  const playerTableBody = document.getElementById('playerTableBody');

  // DOM References - FOH Wireless Mobile Remote (HP Remote)
  const remoteModeBanner = document.getElementById('remoteModeBanner');
  const remoteConnStatus = document.getElementById('remoteConnStatus');
  const btnRemotePinPrompt = document.getElementById('btnRemotePinPrompt');
  const remotePinBtnText = document.getElementById('remotePinBtnText');
  const btnExitRemoteSim = document.getElementById('btnExitRemoteSim');
  const btnOpenRemoteModal = document.getElementById('btnOpenRemoteModal');
  const remoteHeaderLabel = document.getElementById('remoteHeaderLabel');
  const remoteModal = document.getElementById('remoteModal');
  const btnCloseRemoteModal = document.getElementById('btnCloseRemoteModal');
  const btnCancelRemoteModal = document.getElementById('btnCancelRemoteModal');
  const remoteMasterSetupPanel = document.getElementById('remoteMasterSetupPanel');
  const remoteClientPinPanel = document.getElementById('remoteClientPinPanel');
  const remoteModalClientCount = document.getElementById('remoteModalClientCount');
  const chkRemoteEnabled = document.getElementById('chkRemoteEnabled');
  const remotePinDisplay = document.getElementById('remotePinDisplay');
  const btnRegenRemotePin = document.getElementById('btnRegenRemotePin');
  const btnRefreshRemoteIps = document.getElementById('btnRefreshRemoteIps');
  const remoteUrlList = document.getElementById('remoteUrlList');
  const remoteQrCanvas = document.getElementById('remoteQrCanvas');
  const remoteQrCaption = document.getElementById('remoteQrCaption');
  const remoteManualIpInput = document.getElementById('remoteManualIpInput');
  const btnApplyManualIp = document.getElementById('btnApplyManualIp');
  const remoteWslBridgeBox = document.getElementById('remoteWslBridgeBox');
  const remoteWslBridgeTitle = document.getElementById('remoteWslBridgeTitle');
  const remoteWslBridgeDesc = document.getElementById('remoteWslBridgeDesc');
  const btnEnableWslBridge = document.getElementById('btnEnableWslBridge');
  const btnEnableWslBridgeText = document.getElementById('btnEnableWslBridgeText');
  const btnCopyWslCmd = document.getElementById('btnCopyWslCmd');
  const remotePinInput = document.getElementById('remotePinInput');
  const btnSaveRemotePin = document.getElementById('btnSaveRemotePin');
  const remotePinFeedback = document.getElementById('remotePinFeedback');
  const btnOpenRemoteSimTab = document.getElementById('btnOpenRemoteSimTab');
  const remoteClientsList = document.getElementById('remoteClientsList');
  const btnKickAllRemotes = document.getElementById('btnKickAllRemotes');
  const remoteBlockedSection = document.getElementById('remoteBlockedSection');
  const remoteBlockedList = document.getElementById('remoteBlockedList');

  // Detect whether this tab is Master FOH Deck (Laptop/PC) or Wireless Remote Controller (HP)
  const initialUrlParams = new URLSearchParams(window.location.search);
  const isLocalhostHost = ['127.0.0.1', 'localhost', '::1'].includes(window.location.hostname);
  const isRemoteController = initialUrlParams.get('remote') === '1' || !isLocalhostHost;

  let remotePin = '';
  try {
    const urlPin = (initialUrlParams.get('pin') || '').trim();
    if (urlPin) {
      remotePin = urlPin;
      localStorage.setItem(REMOTE_PIN_STORAGE_KEY, urlPin);
      initialUrlParams.delete('pin');
      const cleanSearch = initialUrlParams.toString();
      const newRelativeUrl = window.location.pathname + (cleanSearch ? '?' + cleanSearch : '');
      window.history.replaceState({}, '', newRelativeUrl);
    } else {
      remotePin = localStorage.getItem(REMOTE_PIN_STORAGE_KEY) || '';
    }
  } catch (_e) {
    // Ignore storage errors
  }

  let remoteClientId = 'rm_default';
  try {
    const clientStorage = isLocalhostHost ? sessionStorage : localStorage;
    let cid = clientStorage.getItem(REMOTE_CLIENT_ID_KEY);
    if (!cid) {
      cid = 'rm_' + Math.random().toString(36).slice(2, 10);
      clientStorage.setItem(REMOTE_CLIENT_ID_KEY, cid);
    }
    remoteClientId = cid;
  } catch (_e) {
    // Ignore storage errors
  }

  // State Management
  const sharedInit = getSharedWorkspaceState();
  let currentSourceDir = sharedInit.sourceDir || '';
  let defaultInboxDir = '';
  let activePlaylist = sharedInit.activePlaylist || 'ALL';
  let activeTrackRelPath = sharedInit.activeTrackRelPath || '';

  let allFiles = [];
  let allPlaylists = [];
  let visibleFiles = [];
  let activeTrackObj = null;

  let playMode = 'cue'; // 'cue' | 'continuous' | 'loop'
  let routingMode = 'stereo'; // 'stereo' | 'mono' | 'left' | 'right' | 'invert'
  let activeDspTab = 'eq'; // 'eq' | 'routing' | 'output' | ''
  let cuePadsCollapsed = false;
  let isMuted = false;
  let isSeeking = false;
  let isFadingOut = false;
  let fadeTimerId = null;
  let isAuditRunning = false;
  let isPageUnloading = false;
  let hasRestoredInitialSession = false;
  let pendingAutoResumeOnGesture = false;

  // Remote Sync State (Telemetry & Anti-Jitter Lock)
  let remoteIsPlaying = false;
  let remoteCurrentTime = 0;
  let remoteDuration = 0;
  let remoteRtaBands = Array(32).fill(0);
  let remoteVuL = 0;
  let remoteVuR = 0;
  let latestRtaBands = Array(32).fill(0);
  let latestVuL = 0;
  let latestVuR = 0;
  let lastLocalControlTouchAt = 0;
  let hasPromptedPinModalOnce = false;

  function isDeckPlaying() {
    return isRemoteController
      ? Boolean(remoteIsPlaying)
      : Boolean(audioEl && !audioEl.paused && !audioEl.ended);
  }

  const collapsedGroups = new Set();
  const groupDomMap = new Map();
  const rowDomByRelPath = new Map();

  let cuePads = loadCuePads();

  // Web Audio API Graph State
  let audioCtx = null;
  let mediaSourceNode = null;
  let preampGainNode = null;
  let eqLowNode = null;
  let eqMidNode = null;
  let eqHighNode = null;
  let splitterNode = null;
  let routeLL = null;
  let routeLR = null;
  let routeRL = null;
  let routeRR = null;
  let mergerNode = null;
  let masterGainNode = null;
  let fadeGainNode = null;
  let rtaAnalyser = null;
  let meterSplitter = null;
  let meterAnalyserL = null;
  let meterAnalyserR = null;
  let maxPeakHoldDb = -Infinity;

  const groupCollapseCtrl = createGroupCollapseController({
    collapsedGroups,
    groupDomMap,
    btnCollapseAll: btnCollapseAllGroups,
    btnExpandAll: btnExpandAllGroups,
  });

  // ---------------------------------------------------------------------------
  // 1. Preferences & Cue Pads Persistence
  // ---------------------------------------------------------------------------
  function loadCuePads() {
    try {
      const raw = localStorage.getItem(CUE_PADS_STORAGE_KEY);
      if (!raw) return Array(8).fill(null);
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return Array(8).fill(null);
      const result = Array(8).fill(null);
      for (let i = 0; i < 8; i++) {
        const item = parsed[i];
        if (item && typeof item.rel_path === 'string' && item.rel_path) {
          result[i] = {
            rel_path: String(item.rel_path),
            name: String(item.name || item.rel_path),
            folder: String(item.folder || ''),
            source_dir: String(item.source_dir || ''),
          };
        }
      }
      return result;
    } catch (_e) {
      return Array(8).fill(null);
    }
  }

  function saveCuePads() {
    try {
      localStorage.setItem(CUE_PADS_STORAGE_KEY, JSON.stringify(cuePads));
    } catch (_e) {
      // Ignore storage quota errors
    }
  }

  function loadPlayerPrefs() {
    try {
      const raw = localStorage.getItem(PLAYER_PREFS_STORAGE_KEY);
      if (!raw) return;
      const prefs = JSON.parse(raw);
      if (prefs.playMode && ['cue', 'continuous', 'loop'].includes(prefs.playMode)) {
        playMode = prefs.playMode;
      }
      if (typeof prefs.volume === 'number' && volumeSlider) {
        volumeSlider.value = String(Math.max(0, Math.min(100, prefs.volume)));
      }
      if (typeof prefs.autoTrim === 'boolean' && chkAutoTrim) {
        chkAutoTrim.checked = prefs.autoTrim;
      }
      if (typeof prefs.cuePadsCollapsed === 'boolean') {
        cuePadsCollapsed = prefs.cuePadsCollapsed;
      }
    } catch (_e) {
      // Ignore parse errors
    }
  }

  function savePlayerPrefs() {
    try {
      localStorage.setItem(
        PLAYER_PREFS_STORAGE_KEY,
        JSON.stringify({
          playMode,
          volume: volumeSlider ? Number(volumeSlider.value) : 100,
          autoTrim: chkAutoTrim ? Boolean(chkAutoTrim.checked) : true,
          cuePadsCollapsed,
        })
      );
    } catch (_e) {
      // Ignore storage errors
    }
  }

  function persistWorkspaceState() {
    saveSharedWorkspaceState({
      sourceDir: currentSourceDir,
      activePlaylist,
      activeTrackRelPath,
    });
  }

  function savePlaybackSessionState(overrideIsPlaying = null) {
    if (!activeTrackObj || !audioEl) return;
    try {
      const isPlayingNow =
        overrideIsPlaying !== null
          ? Boolean(overrideIsPlaying)
          : Boolean(!audioEl.paused && !audioEl.ended);
      const curSec = Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : 0;
      sessionStorage.setItem(
        PLAYBACK_SESSION_STORAGE_KEY,
        JSON.stringify({
          rel_path: activeTrackObj.rel_path,
          source_dir: currentSourceDir || '',
          currentTime: curSec,
          isPlaying: isPlayingNow,
          savedAt: Date.now(),
        })
      );
    } catch (_e) {
      // Ignore storage errors
    }
  }

  function loadPlaybackSessionState() {
    try {
      const raw = sessionStorage.getItem(PLAYBACK_SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.rel_path !== 'string') return null;
      return {
        rel_path: parsed.rel_path,
        source_dir: String(parsed.source_dir || ''),
        currentTime:
          typeof parsed.currentTime === 'number' && Number.isFinite(parsed.currentTime)
            ? Math.max(0, parsed.currentTime)
            : 0,
        isPlaying: Boolean(parsed.isPlaying),
        savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
      };
    } catch (_e) {
      return null;
    }
  }

  window.addEventListener('beforeunload', e => {
    const isActivelyPlaying = Boolean(audioEl && !audioEl.paused && !audioEl.ended);
    savePlaybackSessionState(isActivelyPlaying);
    if (isActivelyPlaying) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  window.addEventListener('pagehide', () => {
    isPageUnloading = true;
  });

  // ---------------------------------------------------------------------------
  // 2. Web Audio API DSP Engine (Preamp, 3-Band EQ, Phase Matrix, RTA & Meters)
  // ---------------------------------------------------------------------------
  function connectMediaElementToGraphIfReady() {
    if (!audioCtx || !audioEl || mediaSourceNode || !preampGainNode) return;
    if (audioCtx.state !== 'running') return;
    try {
      mediaSourceNode = audioCtx.createMediaElementSource(audioEl);
      mediaSourceNode.connect(preampGainNode);
      applyGainAndEqNodes();
    } catch (_e) {
      // Ignore if already connected
    }
  }

  function ensureAudioGraph() {
    if (!audioEl) return;
    if (audioCtx) {
      connectMediaElementToGraphIfReady();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      audioCtx = new AudioContextClass();

      preampGainNode = audioCtx.createGain();

      eqLowNode = audioCtx.createBiquadFilter();
      eqLowNode.type = 'lowshelf';
      eqLowNode.frequency.value = 80;
      eqLowNode.gain.value = 0;

      eqMidNode = audioCtx.createBiquadFilter();
      eqMidNode.type = 'peaking';
      eqMidNode.frequency.value = 1000;
      eqMidNode.Q.value = 1.0;
      eqMidNode.gain.value = 0;

      eqHighNode = audioCtx.createBiquadFilter();
      eqHighNode.type = 'highshelf';
      eqHighNode.frequency.value = 10000;
      eqHighNode.gain.value = 0;

      // 2x2 Channel Routing & Phase Matrix
      splitterNode = audioCtx.createChannelSplitter(2);
      routeLL = audioCtx.createGain();
      routeLR = audioCtx.createGain();
      routeRL = audioCtx.createGain();
      routeRR = audioCtx.createGain();
      mergerNode = audioCtx.createChannelMerger(2);

      masterGainNode = audioCtx.createGain();
      fadeGainNode = audioCtx.createGain();

      // Analyzers for RTA Spectrum & L/R Peak Meters
      rtaAnalyser = audioCtx.createAnalyser();
      rtaAnalyser.fftSize = 2048;
      rtaAnalyser.smoothingTimeConstant = 0.78;

      meterSplitter = audioCtx.createChannelSplitter(2);
      meterAnalyserL = audioCtx.createAnalyser();
      meterAnalyserL.fftSize = 1024;
      meterAnalyserR = audioCtx.createAnalyser();
      meterAnalyserR.fftSize = 1024;

      // Connect Signal Chain (preamp -> EQ -> Matrix -> Master -> Destination)
      preampGainNode.connect(eqLowNode);
      eqLowNode.connect(eqMidNode);
      eqMidNode.connect(eqHighNode);
      eqHighNode.connect(splitterNode);

      // Left input (0) -> routeLL (to Out L) & routeLR (to Out R)
      splitterNode.connect(routeLL, 0);
      splitterNode.connect(routeLR, 0);
      // Right input (1) -> routeRL (to Out L) & routeRR (to Out R)
      splitterNode.connect(routeRL, 1);
      splitterNode.connect(routeRR, 1);

      routeLL.connect(mergerNode, 0, 0);
      routeRL.connect(mergerNode, 0, 0);
      routeLR.connect(mergerNode, 0, 1);
      routeRR.connect(mergerNode, 0, 1);

      mergerNode.connect(masterGainNode);
      masterGainNode.connect(fadeGainNode);
      fadeGainNode.connect(audioCtx.destination);

      // Tap post-fader signal for RTA & Stereo Meters
      fadeGainNode.connect(rtaAnalyser);
      fadeGainNode.connect(meterSplitter);
      meterSplitter.connect(meterAnalyserL, 0);
      meterSplitter.connect(meterAnalyserR, 1);

      audioCtx.addEventListener('statechange', () => {
        connectMediaElementToGraphIfReady();
      });

      // Only attach createMediaElementSource once audioCtx is running so a suspended
      // AudioContext on page refresh never mutes native HTML5 audio playback!
      connectMediaElementToGraphIfReady();

      applyRoutingMatrix();
      applyGainAndEqNodes();
    } catch (_err) {
      // Fallback to native HTMLAudioElement volume if AudioContext fails
    }
  }

  function dbToLinear(db) {
    return Math.pow(10, db / 20);
  }

  function computeRecommendedAutoTrimDb(fileObj) {
    if (!fileObj || !fileObj.qc) return 0;
    const qc = fileObj.qc;
    const tp = qc.true_peak_dbtp !== undefined && qc.true_peak_dbtp !== '' ? parseFloat(qc.true_peak_dbtp) : NaN;
    const lufs = qc.integrated_lufs !== undefined && qc.integrated_lufs !== '' ? parseFloat(qc.integrated_lufs) : NaN;

    let trimDb = 0;
    // Target -14.0 LUFS if track is louder than -14.0 LUFS
    if (!Number.isNaN(lufs) && lufs > -14.0) {
      trimDb = -14.0 - lufs;
    }
    // Also guarantee True Peak never exceeds -1.0 dBTP
    if (!Number.isNaN(tp)) {
      const maxAllowedGainForTp = -1.0 - tp;
      if (maxAllowedGainForTp < trimDb) {
        trimDb = maxAllowedGainForTp;
      }
    }
    return Math.max(-12.0, Math.min(0.0, Math.round(trimDb * 2) / 2));
  }

  function syncRoutingBadgeUI() {
    if (!routingStatusLabel) return;
    const labels = {
      stereo: 'Stereo',
      mono: 'Mono L+R',
      left: 'Left Only',
      right: 'Right Only',
      invert: 'Ø 180°',
    };
    routingStatusLabel.textContent = labels[routingMode] || 'Stereo';
    routingStatusLabel.classList.toggle('active-warn', routingMode !== 'stereo');
  }

  function applyRoutingMatrix() {
    syncRoutingBadgeUI();
    if (!routeLL || !routeLR || !routeRL || !routeRR) return;
    if (routingMode === 'mono') {
      routeLL.gain.value = 0.5;
      routeRL.gain.value = 0.5;
      routeLR.gain.value = 0.5;
      routeRR.gain.value = 0.5;
    } else if (routingMode === 'left') {
      routeLL.gain.value = 1.0;
      routeRL.gain.value = 0.0;
      routeLR.gain.value = 1.0;
      routeRR.gain.value = 0.0;
    } else if (routingMode === 'right') {
      routeLL.gain.value = 0.0;
      routeRL.gain.value = 1.0;
      routeLR.gain.value = 0.0;
      routeRR.gain.value = 1.0;
    } else if (routingMode === 'invert') {
      routeLL.gain.value = 1.0;
      routeRL.gain.value = 0.0;
      routeLR.gain.value = 0.0;
      routeRR.gain.value = -1.0;
    } else {
      routeLL.gain.value = 1.0;
      routeRL.gain.value = 0.0;
      routeLR.gain.value = 0.0;
      routeRR.gain.value = 1.0;
    }
  }

  function applyGainAndEqNodes() {
    const volPct = volumeSlider ? Number(volumeSlider.value) : 100;
    const preampDb = preampSlider ? Number(preampSlider.value) : 0;
    const lowDb = eqLowSlider ? Number(eqLowSlider.value) : 0;
    const midDb = eqMidSlider ? Number(eqMidSlider.value) : 0;
    const highDb = eqHighSlider ? Number(eqHighSlider.value) : 0;

    if (volumeValText) volumeValText.textContent = isMuted ? 'MUTE' : `${volPct}%`;
    if (preampValText) preampValText.textContent = `${preampDb > 0 ? '+' : ''}${preampDb.toFixed(1)} dB`;
    if (eqLowVal) eqLowVal.textContent = `${lowDb > 0 ? '+' : ''}${lowDb} dB`;
    if (eqMidVal) eqMidVal.textContent = `${midDb > 0 ? '+' : ''}${midDb} dB`;
    if (eqHighVal) eqHighVal.textContent = `${highDb > 0 ? '+' : ''}${highDb} dB`;

    const isEqFlat = lowDb === 0 && midDb === 0 && highDb === 0;
    if (eqTabBadge) {
      eqTabBadge.textContent = isEqFlat ? 'Flat' : 'Active';
      eqTabBadge.classList.toggle('active-warn', !isEqFlat);
    }
    if (outputTabBadge) {
      const autoOn = Boolean(chkAutoTrim && chkAutoTrim.checked);
      outputTabBadge.textContent = autoOn ? 'Auto -14 LUFS' : 'Manual';
      outputTabBadge.classList.toggle('accent', autoOn);
    }

    const masterLin = isMuted ? 0 : volPct / 100;
    if (masterGainNode && mediaSourceNode) {
      masterGainNode.gain.value = masterLin;
      if (audioEl) audioEl.volume = 1.0;
    } else if (audioEl) {
      const fallbackGain = Math.max(0, Math.min(1, masterLin * dbToLinear(preampDb)));
      audioEl.volume = fallbackGain;
    }

    if (preampGainNode) {
      preampGainNode.gain.value = dbToLinear(preampDb);
    }
    if (eqLowNode) eqLowNode.gain.value = lowDb;
    if (eqMidNode) eqMidNode.gain.value = midDb;
    if (eqHighNode) eqHighNode.gain.value = highDb;
  }

  // ---------------------------------------------------------------------------
  // 3. Real-Time RTA Spectrum & L/R VU Meter Canvas Loop
  // ---------------------------------------------------------------------------
  let requestRtaWake = null;

  function startRtaRenderLoop() {
    if (!rtaCanvas) return;
    const ctx = rtaCanvas.getContext('2d');
    if (!ctx) return;

    const freqData = new Uint8Array(1024);
    const timeDataL = new Float32Array(1024);
    const timeDataR = new Float32Array(1024);

    // 32 logarithmic frequency bands from ~25 Hz to ~19 kHz
    const numBands = 32;
    let isRunning = false;
    let idleDecayFrames = 0;

    function renderFrame() {
      if (!rtaCanvas || !rtaCanvas.isConnected) {
        isRunning = false;
        return;
      }
      const isPlaying = isDeckPlaying();
      if (!isPlaying) {
        if (idleDecayFrames <= 0) {
          isRunning = false;
          latestVuL = 0;
          latestVuR = 0;
          return;
        }
        idleDecayFrames--;
      } else {
        idleDecayFrames = 4;
      }

      const w = rtaCanvas.width;
      const h = rtaCanvas.height;
      ctx.fillStyle = '#050507';
      ctx.fillRect(0, 0, w, h);

      // Subtle dB grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1;
      for (let i = 1; i <= 3; i++) {
        const y = Math.round((h / 4) * i);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      const meterAreaWidth = 46;
      const rtaWidth = w - meterAreaWidth - 8;
      const barStep = rtaWidth / numBands;
      const barWidth = Math.max(4, barStep - 3);

      if (isRemoteController) {
        if (isPlaying && Array.isArray(remoteRtaBands) && remoteRtaBands.length > 0) {
          for (let b = 0; b < numBands; b++) {
            const norm = Math.max(0, Math.min(1, (Number(remoteRtaBands[b]) || 0) / 100));
            const barH = Math.max(2, Math.round(norm * (h - 10)));
            const x = Math.round(b * barStep + 2);
            const y = h - barH - 2;
            if (norm > 0.85) {
              ctx.fillStyle = '#ff3b3b';
            } else if (norm > 0.68) {
              ctx.fillStyle = '#ffbe0b';
            } else {
              ctx.fillStyle = '#00e5ff';
            }
            ctx.fillRect(x, y, barWidth, barH);
          }
        } else {
          for (let b = 0; b < numBands; b++) {
            const x = Math.round(b * barStep + 2);
            ctx.fillStyle = 'rgba(0, 229, 255, 0.18)';
            ctx.fillRect(x, h - 4, barWidth, 2);
          }
        }
        const meterX = rtaWidth + 8;
        const singleMeterW = 16;
        drawVuBar(ctx, meterX, 4, singleMeterW, h - 8, isPlaying ? remoteVuL : 0);
        drawVuBar(ctx, meterX + singleMeterW + 6, 4, singleMeterW, h - 8, isPlaying ? remoteVuR : 0);

        if (isRunning) {
          requestAnimationFrame(renderFrame);
        }
        return;
      }

      if (rtaAnalyser && isPlaying) {
        rtaAnalyser.getByteFrequencyData(freqData);
        const binCount = rtaAnalyser.frequencyBinCount;

        for (let b = 0; b < numBands; b++) {
          const startBin = Math.max(1, Math.floor(Math.pow(binCount, b / numBands)));
          const endBin = Math.max(startBin + 1, Math.floor(Math.pow(binCount, (b + 1) / numBands)));
          let sum = 0;
          let count = 0;
          for (let k = startBin; k < endBin && k < binCount; k++) {
            sum += freqData[k];
            count++;
          }
          const avg = count > 0 ? sum / count : 0;
          const norm = avg / 255;
          latestRtaBands[b] = Math.round(norm * 100);
          const barH = Math.max(2, Math.round(norm * (h - 10)));
          const x = Math.round(b * barStep + 2);
          const y = h - barH - 2;

          if (norm > 0.85) {
            ctx.fillStyle = '#ff3b3b';
          } else if (norm > 0.68) {
            ctx.fillStyle = '#ffbe0b';
          } else {
            ctx.fillStyle = '#00e5ff';
          }
          ctx.fillRect(x, y, barWidth, barH);
        }
      } else {
        for (let b = 0; b < numBands; b++) {
          latestRtaBands[b] = 0;
          const x = Math.round(b * barStep + 2);
          ctx.fillStyle = 'rgba(0, 229, 255, 0.18)';
          ctx.fillRect(x, h - 4, barWidth, 2);
        }
      }

      // Compute L/R Stereo Peak & RMS
      let peakL = 0;
      let peakR = 0;
      if (meterAnalyserL && meterAnalyserR && isPlaying) {
        meterAnalyserL.getFloatTimeDomainData(timeDataL);
        meterAnalyserR.getFloatTimeDomainData(timeDataR);
        for (let i = 0; i < timeDataL.length; i++) {
          const absL = Math.abs(timeDataL[i]);
          const absR = Math.abs(timeDataR[i]);
          if (absL > peakL) peakL = absL;
          if (absR > peakR) peakR = absR;
        }
      }
      latestVuL = peakL;
      latestVuR = peakR;

      const maxInstant = Math.max(peakL, peakR);
      if (maxInstant > 0.0001) {
        const instDb = 20 * Math.log10(maxInstant);
        if (instDb > maxPeakHoldDb) {
          maxPeakHoldDb = instDb;
          updatePeakBadge();
        }
      }

      // Draw L & R Vertical VU Bars on the right side of the canvas
      const meterX = rtaWidth + 8;
      const singleMeterW = 16;
      drawVuBar(ctx, meterX, 4, singleMeterW, h - 8, isPlaying ? peakL : 0);
      drawVuBar(ctx, meterX + singleMeterW + 6, 4, singleMeterW, h - 8, isPlaying ? peakR : 0);

      if (isRunning) {
        requestAnimationFrame(renderFrame);
      }
    }

    function drawVuBar(c, x, y, width, height, peakLin) {
      c.fillStyle = '#121217';
      c.fillRect(x, y, width, height);

      if (peakLin <= 0.0002) return;
      const db = Math.max(-60, Math.min(3, 20 * Math.log10(peakLin)));
      const norm = (db + 60) / 60;
      const fillH = Math.max(2, Math.min(height, Math.round(norm * height)));
      const fillY = y + height - fillH;

      if (db > -0.5) {
        c.fillStyle = '#ff3b3b';
      } else if (db > -6.0) {
        c.fillStyle = '#ffbe0b';
      } else {
        c.fillStyle = '#00f59b';
      }
      c.fillRect(x, fillY, width, fillH);
    }

    function wakeRtaLoop() {
      idleDecayFrames = 4;
      if (!isRunning) {
        isRunning = true;
        requestAnimationFrame(renderFrame);
      }
    }
    requestRtaWake = wakeRtaLoop;

    // Render single initial frame, then sleep until playback begins
    idleDecayFrames = 1;
    renderFrame();
  }

  function updatePeakBadge() {
    if (!meterPeakText) return;
    if (maxPeakHoldDb === -Infinity) {
      meterPeakText.textContent = 'PEAK: -∞ dBFS';
      meterPeakText.className = 'mono-stat peak-readout';
      return;
    }
    const sign = maxPeakHoldDb > 0 ? '+' : '';
    meterPeakText.textContent = `PEAK: ${sign}${maxPeakHoldDb.toFixed(1)} dBFS`;
    meterPeakText.className = 'mono-stat peak-readout' + (maxPeakHoldDb >= -0.2 ? ' clip' : '');
  }

  // ---------------------------------------------------------------------------
  // 4. Timecode Formatting & Transport Logic
  // ---------------------------------------------------------------------------
  function formatTimecode(sec, includeTenths = true) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const mins = Math.floor(sec / 60);
    const remSec = Math.floor(sec % 60);
    const tenths = Math.floor((sec - Math.floor(sec)) * 10);
    const mm = String(mins).padStart(2, '0');
    const ss = String(remSec).padStart(2, '0');
    return includeTenths ? `${mm}:${ss}.${tenths}` : `${mm}:${ss}`;
  }

  function setTransportStateBadge(state) {
    if (!playerStateBadge) return;
    if (state === 'PLAYING') {
      playerStateBadge.textContent = 'ON AIR';
      playerStateBadge.className = 'foh-state-pill playing';
    } else if (state === 'FADING') {
      playerStateBadge.textContent = 'FADING OUT';
      playerStateBadge.className = 'foh-state-pill fading';
    } else if (state === 'CUED') {
      playerStateBadge.textContent = 'CUED';
      playerStateBadge.className = 'foh-state-pill cued';
    } else if (state === 'PAUSED') {
      playerStateBadge.textContent = 'PAUSED';
      playerStateBadge.className = 'foh-state-pill paused';
    } else {
      playerStateBadge.textContent = 'STANDBY';
      playerStateBadge.className = 'foh-state-pill standby';
    }
  }

  function cancelActiveFade() {
    if (fadeTimerId) {
      clearTimeout(fadeTimerId);
      fadeTimerId = null;
    }
    isFadingOut = false;
    if (fadeGainNode && audioCtx) {
      fadeGainNode.gain.cancelScheduledValues(audioCtx.currentTime);
      fadeGainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
    }
  }

  function buildStreamUrl(fileObj) {
    const params = new URLSearchParams();
    if (currentSourceDir) params.set('source_dir', currentSourceDir);
    params.set('rel_path', fileObj.rel_path);
    return '/api/stream?' + params.toString();
  }

  function setRemoteMobileView(viewName) {
    if (!isRemoteController) return;
    const valid = ['setlist', 'pads'].includes(viewName) ? viewName : 'setlist';
    document.body.dataset.remoteView = valid;
    const tabBtns = document.querySelectorAll('#remoteMobileTabs .remote-mobile-tab');
    tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.remoteView === valid);
    });
  }

  function loadTrack(fileObj, autoPlay = false, opts = {}) {
    if (!fileObj || !audioEl) return;
    if (isRemoteController && !opts.fromRemoteSync) {
      sendRemoteCommand('load_track', {
        rel_path: fileObj.rel_path,
        auto_play: Boolean(autoPlay),
      });
      return;
    }
    cancelActiveFade();
    ensureAudioGraph();

    activeTrackObj = fileObj;
    activeTrackRelPath = fileObj.rel_path;
    persistWorkspaceState();

    maxPeakHoldDb = -Infinity;
    updatePeakBadge();

    // Auto-Trim calculation if enabled
    if (chkAutoTrim && chkAutoTrim.checked && preampSlider) {
      const autoDb = computeRecommendedAutoTrimDb(fileObj);
      preampSlider.value = String(autoDb);
    }
    applyGainAndEqNodes();

    const startTime =
      typeof opts.startTime === 'number' && Number.isFinite(opts.startTime) && opts.startTime > 0
        ? opts.startTime
        : 0;

    audioEl.src = buildStreamUrl(fileObj);
    audioEl.load();

    if (seekSlider) {
      seekSlider.disabled = false;
      seekSlider.value = '0';
    }

    if (startTime > 0) {
      const applyStartTime = () => {
        try {
          if (Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
            audioEl.currentTime = Math.min(startTime, Math.max(0, audioEl.duration - 0.2));
          } else {
            audioEl.currentTime = startTime;
          }
          updateTimecodeUI();
        } catch (_e) {
          // Ignore seek before metadata ready
        }
      };
      if (audioEl.readyState >= 1) {
        applyStartTime();
      } else {
        audioEl.addEventListener('loadedmetadata', applyStartTime, { once: true });
      }
    }

    updateNowPlayingCard(fileObj);
    highlightActiveRowInTable();
    renderCuePads();

    if (autoPlay) {
      playCurrentTrack({ isSessionRestore: Boolean(opts.isSessionRestore), startTime });
    } else {
      setTransportStateBadge('CUED');
      syncPlayPauseButton(false);
      savePlaybackSessionState(false);
    }
  }

  async function playCurrentTrack(opts = {}) {
    if (isRemoteController) {
      sendRemoteCommand('play');
      return;
    }
    if (!audioEl) return;
    if (!activeTrackObj) {
      if (visibleFiles.length > 0) {
        loadTrack(visibleFiles[0], true);
      } else if (allFiles.length > 0) {
        loadTrack(allFiles[0], true);
      }
      return;
    }

    cancelActiveFade();
    ensureAudioGraph();
    if (audioCtx && audioCtx.state === 'suspended') {
      try {
        await audioCtx.resume();
      } catch (_e) {
        // Ignore resume error on auto-reload without gesture
      }
    }
    connectMediaElementToGraphIfReady();

    try {
      await audioEl.play();
      if (requestRtaWake) requestRtaWake();
      pendingAutoResumeOnGesture = false;
      setTransportStateBadge('PLAYING');
      syncPlayPauseButton(true);
      highlightActiveRowInTable();
      renderCuePads();
      savePlaybackSessionState(true);
    } catch (err) {
      if (opts && opts.isSessionRestore) {
        pendingAutoResumeOnGesture = true;
        setTransportStateBadge('PAUSED');
        syncPlayPauseButton(false);
        highlightActiveRowInTable();
        renderCuePads();
        const resumeAtStr = formatTimecode(opts.startTime || audioEl.currentTime || 0, false);
        notify({
          type: 'info',
          title: `Posisi Lagu Dipulihkan (${resumeAtStr})`,
          message: 'Klik di mana saja atau tekan Space untuk melanjutkan pemutaran.',
          duration: 4200,
        });
        return;
      }
      notify({
        type: 'error',
        title: 'Gagal Memutar Audio',
        message: err?.message || 'Format atau file tidak dapat diputar.',
      });
    }
  }

  function pauseCurrentTrack() {
    if (isRemoteController) {
      sendRemoteCommand('pause');
      return;
    }
    if (!audioEl) return;
    pendingAutoResumeOnGesture = false;
    cancelActiveFade();
    audioEl.pause();
    setTransportStateBadge('PAUSED');
    syncPlayPauseButton(false);
    highlightActiveRowInTable();
    renderCuePads();
    savePlaybackSessionState(false);
  }

  function stopAndResetCue() {
    if (isRemoteController) {
      sendRemoteCommand('stop');
      return;
    }
    if (!audioEl) return;
    pendingAutoResumeOnGesture = false;
    cancelActiveFade();
    audioEl.pause();
    audioEl.currentTime = 0;
    updateTimecodeUI();
    setTransportStateBadge(activeTrackObj ? 'CUED' : 'STANDBY');
    syncPlayPauseButton(false);
    highlightActiveRowInTable();
    renderCuePads();
    savePlaybackSessionState(false);
  }

  function triggerSmoothFadeOut(durationSec = 3.0) {
    if (isRemoteController) {
      sendRemoteCommand('fade', { duration: durationSec });
      return;
    }
    if (!audioEl || audioEl.paused || isFadingOut) return;
    ensureAudioGraph();
    isFadingOut = true;
    setTransportStateBadge('FADING');

    if (fadeGainNode && audioCtx) {
      const now = audioCtx.currentTime;
      fadeGainNode.gain.cancelScheduledValues(now);
      fadeGainNode.gain.setValueAtTime(1.0, now);
      fadeGainNode.gain.linearRampToValueAtTime(0.0001, now + durationSec);
    }

    fadeTimerId = setTimeout(() => {
      fadeTimerId = null;
      isFadingOut = false;
      audioEl.pause();
      if (fadeGainNode && audioCtx) {
        fadeGainNode.gain.cancelScheduledValues(audioCtx.currentTime);
        fadeGainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
      }
      setTransportStateBadge('PAUSED');
      syncPlayPauseButton(false);
      highlightActiveRowInTable();
      renderCuePads();
    }, Math.round(durationSec * 1000));
  }

  function getAdjacentTrack(offset) {
    const list = visibleFiles.length > 0 ? visibleFiles : allFiles;
    if (list.length === 0) return null;
    if (!activeTrackObj) return list[0];
    const idx = list.findIndex(f => f.rel_path === activeTrackObj.rel_path);
    if (idx === -1) return list[0];
    const nextIdx = idx + offset;
    if (nextIdx < 0 || nextIdx >= list.length) return null;
    return list[nextIdx];
  }

  const deckStateListeners = new Set();
  function notifyDeckStateChange() {
    deckStateListeners.forEach(fn => {
      try { fn(); } catch (_) {}
    });
    window.dispatchEvent(new CustomEvent('swararia:deck-state-change'));
  }

  function syncPlayPauseButton(isPlaying) {
    if (btnPlayPause && btnPlayPauseText) {
      btnPlayPause.classList.toggle('is-playing', isPlaying);
      btnPlayPauseText.textContent = isPlaying ? '❚❚ PAUSE' : '▶ PLAY CUE';
    }
    notifyDeckStateChange();
  }

  function updateNowPlayingCard(fileObj) {
    if (!nowPlayingTitle || !nowPlayingMetaRow || !nowPlayingIndex) return;
    const list = visibleFiles.length > 0 ? visibleFiles : allFiles;
    const idx = list.findIndex(f => f.rel_path === fileObj.rel_path);
    nowPlayingIndex.textContent = idx >= 0 ? String(idx + 1).padStart(2, '0') : '♪';
    nowPlayingTitle.textContent = fileObj.name;
    nowPlayingTitle.title = fileObj.name;

    nowPlayingMetaRow.replaceChildren();
    const folderChip = document.createElement('span');
    folderChip.className = 'meta-chip';
    folderChip.textContent = fileObj.folder ? fileObj.folder : 'Root Inbox';
    nowPlayingMetaRow.appendChild(folderChip);

    const extChip = document.createElement('span');
    extChip.className = 'meta-chip accent';
    extChip.textContent = (fileObj.ext || '').toUpperCase().replace('.', '') + ` • ${fileObj.size_mb} MB`;
    nowPlayingMetaRow.appendChild(extChip);

    const qc = fileObj.qc || {};
    if (qc.sample_rate_hz) {
      const srChip = document.createElement('span');
      srChip.className = 'meta-chip';
      srChip.textContent = `${(Number(qc.sample_rate_hz) / 1000).toFixed(1)} kHz`;
      nowPlayingMetaRow.appendChild(srChip);
    }

    const specBadge = createSpectralBadge(qc);
    if (specBadge) {
      nowPlayingMetaRow.appendChild(specBadge);
    }

    // Compact QC Pill & Next Cue Hint
    if (nowPlayingQcBanner && nowPlayingQcText) {
      const tp = qc.true_peak_dbtp !== undefined && qc.true_peak_dbtp !== '' ? parseFloat(qc.true_peak_dbtp) : NaN;
      const lufs = qc.integrated_lufs !== undefined && qc.integrated_lufs !== '' ? parseFloat(qc.integrated_lufs) : NaN;
      const autoTrimDb = computeRecommendedAutoTrimDb(fileObj);

      if (!Number.isNaN(tp)) {
        const lufsStr = !Number.isNaN(lufs) ? ` • ${lufs.toFixed(1)} LUFS` : '';
        const tpStr = `${tp > 0 ? '+' : ''}${tp.toFixed(1)} dBTP`;
        const trimNote =
          chkAutoTrim && chkAutoTrim.checked && autoTrimDb < 0
            ? ` (Trim ${autoTrimDb.toFixed(1)} dB)`
            : '';

        if (tp > 0.0 || qc.spectral_status === 'FAKE_HQ') {
          nowPlayingQcBanner.className = 'now-playing-qc-banner danger';
          nowPlayingQcText.textContent = `Clipping ${tpStr}${lufsStr}${trimNote}`;
        } else if (tp > -1.0) {
          nowPlayingQcBanner.className = 'now-playing-qc-banner warn';
          nowPlayingQcText.textContent = `Trim Required ${tpStr}${lufsStr}${trimNote}`;
        } else {
          nowPlayingQcBanner.className = 'now-playing-qc-banner safe';
          nowPlayingQcText.textContent = `FOH Ready • ${tpStr}${lufsStr}${trimNote}`;
        }
      } else {
        nowPlayingQcBanner.className = 'now-playing-qc-banner neutral';
        nowPlayingQcText.textContent = 'QC Unprobed';
      }
    }

    const nextTrack = getAdjacentTrack(1);
    if (nextCueHint) {
      nextCueHint.textContent = nextTrack ? `Next: ${nextTrack.name}` : 'Next: (End of Setlist)';
      nextCueHint.title = nextTrack ? nextTrack.name : '';
    }
    notifyDeckStateChange();
  }

  function updateTimecodeUI() {
    if (!audioEl && !isRemoteController) return;
    const cur = isRemoteController
      ? remoteCurrentTime
      : Number.isFinite(audioEl.currentTime)
        ? audioEl.currentTime
        : 0;
    const dur = isRemoteController
      ? remoteDuration
      : Number.isFinite(audioEl.duration)
        ? audioEl.duration
        : 0;
    const rem = Math.max(0, dur - cur);

    if (timeElapsed) timeElapsed.textContent = formatTimecode(cur, true);
    if (timeDuration) timeDuration.textContent = formatTimecode(dur, true);
    if (timeRemaining) timeRemaining.textContent = '-' + formatTimecode(rem, true);

    if (countdownBox) {
      const isPlaying = isDeckPlaying() && dur > 0;
      countdownBox.classList.toggle('warn-10s', isPlaying && rem > 0 && rem <= 10.0);
      countdownBox.classList.toggle('warn-30s', isPlaying && rem > 10.0 && rem <= 30.0);
    }

    if (seekSlider && !isSeeking && dur > 0) {
      seekSlider.disabled = false;
      seekSlider.value = String(Math.round((cur / dur) * 1000));
    }
  }

  // Global Bridge for Persistent Floating Deck and External Triggers
  window.__swarariaFohDeck = {
    getTrack: () => activeTrackObj,
    isPlaying: () => isDeckPlaying(),
    getAudioEl: () => audioEl,
    play: () => playCurrentTrack(),
    pause: () => pauseCurrentTrack(),
    togglePlay: () => {
      if (isDeckPlaying()) {
        pauseCurrentTrack();
      } else {
        playCurrentTrack();
      }
    },
    stop: () => stopAndResetCue(),
    next: () => {
      if (isRemoteController) {
        sendRemoteCommand('next');
        return;
      }
      const next = getAdjacentTrack(1);
      if (next) loadTrack(next, true);
    },
    prev: () => {
      if (isRemoteController) {
        sendRemoteCommand('prev');
        return;
      }
      const prev = getAdjacentTrack(-1);
      if (prev) loadTrack(prev, true);
    },
    seek: (sec) => {
      if (audioEl && Number.isFinite(sec)) {
        audioEl.currentTime = Math.max(0, Math.min(audioEl.duration || 0, sec));
        updateTimecodeUI();
      }
    },
    getPlayMode: () => playMode,
    setPlayMode: (mode) => {
      if (mode === 'cue' && modeBtnCue) modeBtnCue.click();
      else if (mode === 'continuous' && modeBtnContinuous) modeBtnContinuous.click();
      else if (mode === 'loop' && modeBtnLoop) modeBtnLoop.click();
      notifyDeckStateChange();
    },
    getVolume: () => {
      return volumeSlider ? Number(volumeSlider.value) : (audioEl ? audioEl.volume * 100 : 100);
    },
    setVolume: (val) => {
      if (volumeSlider) {
        volumeSlider.value = String(val);
        volumeSlider.dispatchEvent(new Event('input'));
      } else if (audioEl) {
        audioEl.volume = Math.max(0, Math.min(100, val)) / 100;
      }
    },
    onStateChange: (fn) => {
      deckStateListeners.add(fn);
      return () => deckStateListeners.delete(fn);
    },
    notifyStateChange: notifyDeckStateChange,
  };

  // Re-sync full console whenever view is activated in SPA
  window.addEventListener('swararia:player-activated', () => {
    updateTimecodeUI();
    if (activeTrackObj) {
      updateNowPlayingCard(activeTrackObj);
      highlightActiveRowInTable();
    }
    syncPlayPauseButton(isDeckPlaying());
    setTransportStateBadge(isDeckPlaying() ? 'PLAYING' : activeTrackObj ? 'CUED' : 'STANDBY');
    if (requestRtaWake && isDeckPlaying()) {
      requestRtaWake();
    }
  });

  // ---------------------------------------------------------------------------
  // 5. Audio Element Events & Play Mode Transitions
  // ---------------------------------------------------------------------------
  let lastSessionSaveTime = 0;
  function savePlaybackSessionStateThrottled(minIntervalMs = 2000) {
    const now = Date.now();
    if (now - lastSessionSaveTime >= minIntervalMs) {
      lastSessionSaveTime = now;
      savePlaybackSessionState();
    }
  }

  if (audioEl) {
    audioEl.addEventListener('timeupdate', () => {
      updateTimecodeUI();
      if (!isPageUnloading) {
        savePlaybackSessionStateThrottled(2000);
      }
    });
    audioEl.addEventListener('loadedmetadata', updateTimecodeUI);
    audioEl.addEventListener('play', () => {
      if (requestRtaWake) requestRtaWake();
      if (!isPageUnloading) savePlaybackSessionState(true);
    });
    audioEl.addEventListener('pause', () => {
      if (!isPageUnloading && !audioEl.ended) savePlaybackSessionState(false);
    });
    audioEl.addEventListener('seeked', () => {
      if (!isPageUnloading) savePlaybackSessionState();
    });
    audioEl.addEventListener('ended', () => {
      cancelActiveFade();
      if (playMode === 'loop') {
        audioEl.currentTime = 0;
        playCurrentTrack();
        return;
      }

      const nextTrack = getAdjacentTrack(1);
      if (playMode === 'continuous' && nextTrack) {
        loadTrack(nextTrack, true);
        return;
      }

      // Default Soundman CUE MODE: Auto-Stop at end of song & cue next track safely!
      if (nextTrack) {
        loadTrack(nextTrack, false);
        notify({
          type: 'info',
          title: 'Cue Mode: Auto-Stop Selesai',
          message: `Siap di Cue berikutnya: "${nextTrack.name}" (Tekan Space untuk Play).`,
          duration: 3800,
        });
      } else {
        stopAndResetCue();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Audio Output Device Enumeration (`setSinkId`)
  // ---------------------------------------------------------------------------
  async function refreshAudioOutputDevices() {
    if (!outputDeviceSelect || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter(d => d.kind === 'audiooutput');
      const currentVal = outputDeviceSelect.value;

      outputDeviceSelect.replaceChildren();
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = 'Default System Audio Output';
      outputDeviceSelect.appendChild(defaultOpt);

      outputs.forEach((dev, idx) => {
        if (!dev.deviceId || dev.deviceId === 'default') return;
        const opt = document.createElement('option');
        opt.value = dev.deviceId;
        opt.textContent = dev.label || `Audio Interface / Output #${idx + 1}`;
        outputDeviceSelect.appendChild(opt);
      });

      if (currentVal) outputDeviceSelect.value = currentVal;
    } catch (_e) {
      // Ignore permission errors on restricted browsers
    }
  }

  if (outputDeviceSelect) {
    outputDeviceSelect.addEventListener('change', async () => {
      const sinkId = outputDeviceSelect.value;
      if (audioEl && typeof audioEl.setSinkId === 'function') {
        try {
          await audioEl.setSinkId(sinkId);
          notify({
            type: 'success',
            title: 'Output Audio Diarahkan',
            message: sinkId ? 'Berhasil mengarahkan output ke soundcard terpilih.' : 'Menggunakan output audio default sistem.',
            duration: 2800,
          });
        } catch (err) {
          notify({
            type: 'error',
            title: 'Gagal Mengubah Output Device',
            message: err?.message || 'Browser tidak mengizinkan pengalihan perangkat output.',
          });
        }
      }
    });
  }
  if (btnRefreshDevices) {
    btnRefreshDevices.addEventListener('click', refreshAudioOutputDevices);
  }

  // ---------------------------------------------------------------------------
  // 7. 8 Instant FOH Cue Pads (Collapsible Strip + Track Picker + Drag & Drop)
  // ---------------------------------------------------------------------------
  let pendingPadPickerSlot = 0;

  function syncCuePadsCollapseUI() {
    if (cuePadsBody) {
      cuePadsBody.classList.toggle('collapsed', cuePadsCollapsed);
    }
    if (btnToggleCuePads) {
      btnToggleCuePads.setAttribute('aria-expanded', String(!cuePadsCollapsed));
    }
    if (btnToggleCuePadsText) {
      btnToggleCuePadsText.textContent = cuePadsCollapsed ? 'Show Pads' : 'Hide Pads';
    }
  }

  function syncTablePadButtons() {
    rowDomByRelPath.forEach((tr, relPath) => {
      const btnPad = tr.querySelector('.btn-row-pad');
      if (!btnPad) return;
      const padIdx = cuePads.findIndex(p => p && p.rel_path === relPath);
      if (padIdx >= 0) {
        btnPad.classList.add('assigned');
        btnPad.textContent = `Pad [${padIdx + 1}] ✓`;
        btnPad.title = `Terpasang di Cue Pad [${padIdx + 1}] — Klik untuk melepas dari Pad`;
      } else {
        btnPad.classList.remove('assigned');
        btnPad.textContent = '+ Pad';
        btnPad.title = 'Pasang track ini ke slot Instant Cue Pad kosong berikutnya';
      }
    });
  }

  function renderCuePads() {
    if (!cuePadsGrid) return;
    cuePadsGrid.replaceChildren();

    const assignedCount = cuePads.filter(Boolean).length;
    if (cuePadsCountBadge) {
      cuePadsCountBadge.textContent = `${assignedCount} / 8 Assigned`;
    }

    const nextEmptyIdx = cuePads.findIndex(p => p === null);
    if (btnAssignCurrentText) {
      btnAssignCurrentText.textContent =
        nextEmptyIdx >= 0
          ? `+ Assign Active to Pad [${nextEmptyIdx + 1}]`
          : '+ Assign Active Track';
    }

    for (let i = 0; i < 8; i++) {
      const padData = cuePads[i];
      const isActiveThis = Boolean(
        padData && activeTrackObj && activeTrackObj.rel_path === padData.rel_path
      );
      const isPlayingThis = isActiveThis && isDeckPlaying();

      const padBtn = document.createElement('div');
      padBtn.className =
        'cue-pad-item' +
        (padData ? ' assigned' : '') +
        (isActiveThis && !isPlayingThis ? ' cued' : '') +
        (isPlayingThis ? ' playing' : '');
      padBtn.setAttribute('role', 'button');
      padBtn.tabIndex = 0;
      padBtn.title = padData
        ? `[Hotkey ${i + 1}] ${padData.name} — Klik atau tekan angka ${i + 1} untuk Play/Pause`
        : `Cue Pad [${i + 1}] Kosong — Klik untuk memilih track atau tarik lagu dari tabel ke sini`;

      // Top Row: Key Badge + Status Pill + Quick Actions
      const topRow = document.createElement('div');
      topRow.className = 'cue-pad-top';

      const topLeft = document.createElement('div');
      topLeft.className = 'cue-pad-top-left';

      const keyBadge = document.createElement('span');
      keyBadge.className = 'cue-pad-key';
      keyBadge.textContent = `Key [${i + 1}]`;
      topLeft.appendChild(keyBadge);

      const statusPill = document.createElement('span');
      if (isPlayingThis) {
        statusPill.className = 'cue-pad-status-pill playing';
        statusPill.textContent = '● ON AIR';
      } else if (isActiveThis) {
        statusPill.className = 'cue-pad-status-pill cued';
        statusPill.textContent = 'CUED';
      } else if (padData) {
        statusPill.className = 'cue-pad-status-pill';
        statusPill.textContent = 'READY';
      } else {
        statusPill.className = 'cue-pad-status-pill';
        statusPill.textContent = 'EMPTY';
      }
      topLeft.appendChild(statusPill);
      topRow.appendChild(topLeft);

      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'cue-pad-actions';

      if (padData) {
        const restartBtn = document.createElement('button');
        restartBtn.type = 'button';
        restartBtn.className = 'cue-pad-action-btn';
        restartBtn.textContent = '↺';
        restartBtn.title = `Ulangi Pad [${i + 1}] dari 00:00.0`;
        restartBtn.addEventListener('click', e => {
          e.stopPropagation();
          restartCuePadFromZero(i);
        });
        actionsWrap.appendChild(restartBtn);

        const changeBtn = document.createElement('button');
        changeBtn.type = 'button';
        changeBtn.className = 'cue-pad-action-btn';
        changeBtn.textContent = '⇄';
        changeBtn.title = `Ganti track pada Pad [${i + 1}]`;
        changeBtn.addEventListener('click', e => {
          e.stopPropagation();
          openPadPickerModal(i);
        });
        actionsWrap.appendChild(changeBtn);

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'cue-pad-clear-btn';
        clearBtn.textContent = '✕';
        clearBtn.title = `Kosongkan Pad [${i + 1}]`;
        clearBtn.addEventListener('click', e => {
          e.stopPropagation();
          cuePads[i] = null;
          saveCuePads();
          renderCuePads();
          if (isRemoteController) {
            sendRemoteCommand('clear_pad', { index: i });
          }
        });
        actionsWrap.appendChild(clearBtn);
      } else {
        const pickBtn = document.createElement('button');
        pickBtn.type = 'button';
        pickBtn.className = 'cue-pad-action-btn';
        pickBtn.textContent = '+ Pilih';
        pickBtn.title = `Pilih track untuk Pad [${i + 1}]`;
        pickBtn.addEventListener('click', e => {
          e.stopPropagation();
          openPadPickerModal(i);
        });
        actionsWrap.appendChild(pickBtn);
      }
      topRow.appendChild(actionsWrap);

      // Main Row: Play/Pause/Add Icon + Track Title
      const mainRow = document.createElement('div');
      mainRow.className = 'cue-pad-main-row';

      const playIcon = document.createElement('span');
      playIcon.className = 'cue-pad-play-icon';
      playIcon.textContent = padData ? (isPlayingThis ? '❚❚' : '▶') : '+';
      mainRow.appendChild(playIcon);

      const titleDiv = document.createElement('div');
      titleDiv.className = 'cue-pad-title';
      titleDiv.textContent = padData ? padData.name : 'Pilih Audio Track...';
      mainRow.appendChild(titleDiv);

      // Sub Row: Folder + Action Hint
      const subDiv = document.createElement('div');
      subDiv.className = 'cue-pad-sub';
      if (padData) {
        const folderLabel = padData.folder ? padData.folder : 'Root Inbox';
        subDiv.textContent = isPlayingThis
          ? `${folderLabel} • Klik / [${i + 1}] untuk Pause`
          : `${folderLabel} • Klik / [${i + 1}] untuk Play`;
      } else {
        subDiv.textContent = 'Klik di sini atau tarik lagu dari tabel';
      }

      padBtn.appendChild(topRow);
      padBtn.appendChild(mainRow);
      padBtn.appendChild(subDiv);

      // Click & Keyboard trigger
      padBtn.addEventListener('click', () => triggerCuePad(i));
      padBtn.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          triggerCuePad(i);
        }
      });

      // Drag & Drop target events
      padBtn.addEventListener('dragover', e => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        padBtn.classList.add('drag-over');
      });
      padBtn.addEventListener('dragleave', () => {
        padBtn.classList.remove('drag-over');
      });
      padBtn.addEventListener('drop', e => {
        e.preventDefault();
        padBtn.classList.remove('drag-over');
        const droppedRelPath = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
        if (!droppedRelPath) return;
        const foundFile = allFiles.find(f => f.rel_path === droppedRelPath);
        if (foundFile) {
          assignFileToCuePad(foundFile, i);
        }
      });

      cuePadsGrid.appendChild(padBtn);
    }

    syncTablePadButtons();
  }

  function assignFileToCuePad(fileObj, preferredIndex = null) {
    if (!fileObj) return;
    if (isRemoteController) {
      sendRemoteCommand('assign_pad', {
        rel_path: fileObj.rel_path,
        index: preferredIndex,
      });
      notify({
        type: 'success',
        title:
          preferredIndex !== null
            ? `Dikirim ke Cue Pad [${preferredIndex + 1}]`
            : 'Dikirim ke Cue Pad Master Deck',
        message: `"${fileObj.name}" dipasang ke Cue Pad di Laptop.`,
        duration: 2200,
      });
      return;
    }

    // If no specific slot was requested and this track is already in a Pad, highlight/notify
    const existingIdx = cuePads.findIndex(p => p && p.rel_path === fileObj.rel_path);
    if (preferredIndex === null && existingIdx >= 0) {
      notify({
        type: 'info',
        title: `Sudah Terpasang di Cue Pad [${existingIdx + 1}]`,
        message: `"${fileObj.name}" sudah siap dipicu dengan tombol keyboard [${existingIdx + 1}].`,
        duration: 2400,
      });
      return;
    }

    let targetIdx = preferredIndex;
    if (targetIdx === null || targetIdx < 0 || targetIdx >= 8) {
      targetIdx = cuePads.findIndex(p => p === null);
      if (targetIdx === -1) {
        openPadPickerModal(0);
        notify({
          type: 'info',
          title: 'Semua 8 Cue Pad Sudah Terisi',
          message: 'Silakan hapus atau ganti salah satu slot Pad terlebih dahulu.',
          duration: 3000,
        });
        return;
      }
    }

    // Prevent duplicate assignment across slots if moving to a specific slot
    for (let k = 0; k < 8; k++) {
      if (k !== targetIdx && cuePads[k] && cuePads[k].rel_path === fileObj.rel_path) {
        cuePads[k] = null;
      }
    }

    cuePads[targetIdx] = {
      rel_path: fileObj.rel_path,
      name: fileObj.name,
      folder: fileObj.folder || '',
      source_dir: currentSourceDir || '',
    };
    if (cuePadsCollapsed) {
      cuePadsCollapsed = false;
      syncCuePadsCollapseUI();
      savePlayerPrefs();
    }
    saveCuePads();
    renderCuePads();

    notify({
      type: 'success',
      title: `Terpasang di Cue Pad [${targetIdx + 1}]`,
      message: `"${fileObj.name}" siap diputar instan dengan tombol [${targetIdx + 1}].`,
      duration: 2600,
    });
  }

  function resolveCuePadFileObj(padData) {
    return (
      allFiles.find(f => f.rel_path === padData.rel_path) || {
        rel_path: padData.rel_path,
        name: padData.name,
        folder: padData.folder,
        ext: '.' + (padData.name.split('.').pop() || 'opus').toLowerCase(),
        size_mb: 0,
        qc: {},
      }
    );
  }

  function restartCuePadFromZero(padIndex) {
    const padData = cuePads[padIndex];
    if (!padData) return;
    if (isRemoteController) {
      sendRemoteCommand('restart_pad', { index: padIndex });
      return;
    }
    const found = resolveCuePadFileObj(padData);
    if (activeTrackObj && activeTrackObj.rel_path === found.rel_path && audioEl) {
      audioEl.currentTime = 0;
      playCurrentTrack();
    } else {
      loadTrack(found, true);
    }
  }

  function triggerCuePad(padIndex) {
    const padData = cuePads[padIndex];
    if (!padData) {
      // Friendly behavior: clicking an empty Pad opens the Track Picker Modal for that Pad!
      openPadPickerModal(padIndex);
      return;
    }
    if (isRemoteController) {
      sendRemoteCommand('trigger_pad', { index: padIndex });
      return;
    }

    const found = resolveCuePadFileObj(padData);
    const isSameTrack = Boolean(activeTrackObj && activeTrackObj.rel_path === found.rel_path);
    if (isSameTrack && audioEl) {
      if (!audioEl.paused) {
        pauseCurrentTrack();
      } else {
        playCurrentTrack();
      }
      return;
    }

    loadTrack(found, true);
  }

  // Interactive Cue Pad Track Picker Modal
  function openPadPickerModal(slotIndex) {
    pendingPadPickerSlot = slotIndex;
    if (!padPickerModal) return;

    if (padPickerModalTitle) {
      padPickerModalTitle.textContent = `Pilih Track untuk Cue Pad [${slotIndex + 1}]`;
    }

    if (padPickerActiveBanner && padPickerActiveTitle) {
      if (activeTrackObj) {
        padPickerActiveBanner.classList.remove('hidden');
        padPickerActiveTitle.textContent = activeTrackObj.name;
      } else {
        padPickerActiveBanner.classList.add('hidden');
      }
    }

    if (padPickerSearchInput) {
      padPickerSearchInput.value = '';
    }

    renderPadPickerTrackList('');
    padPickerModal.classList.remove('hidden');
    if (padPickerSearchInput) {
      setTimeout(() => padPickerSearchInput.focus(), 40);
    }
  }

  function closePadPickerModal() {
    if (padPickerModal) {
      padPickerModal.classList.add('hidden');
    }
  }

  function renderPadPickerTrackList(queryText) {
    if (!padPickerList) return;
    padPickerList.replaceChildren();

    const q = (queryText || '').trim().toLowerCase();
    const sourceList = visibleFiles.length > 0 && !q ? visibleFiles : allFiles;
    const matches = sourceList.filter(f => {
      if (!q) return true;
      return `${f.name} ${f.folder || ''} ${f.ext || ''}`.toLowerCase().includes(q);
    });

    if (matches.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'pad-picker-item';
      const infoSpan = document.createElement('span');
      infoSpan.className = 'pad-picker-item-meta';
      infoSpan.textContent = 'Tidak ada track yang cocok dengan pencarian.';
      emptyDiv.appendChild(infoSpan);
      padPickerList.appendChild(emptyDiv);
      return;
    }

    const fragment = document.createDocumentFragment();
    matches.slice(0, 80).forEach(fileObj => {
      const row = document.createElement('div');
      row.className = 'pad-picker-item';

      const info = document.createElement('div');
      info.className = 'pad-picker-item-info';

      const title = document.createElement('div');
      title.className = 'pad-picker-item-title';
      title.textContent = fileObj.name;

      const meta = document.createElement('div');
      meta.className = 'pad-picker-item-meta';
      const folderStr = fileObj.folder ? fileObj.folder : 'Root Inbox';
      const extStr = (fileObj.ext || '').replace('.', '').toUpperCase();
      meta.textContent = `${folderStr} • ${extStr} (${fileObj.size_mb} MB)`;

      info.appendChild(title);
      info.appendChild(meta);

      const assignBtn = document.createElement('button');
      assignBtn.type = 'button';
      assignBtn.className = 'pad-picker-assign-btn';
      assignBtn.textContent = `Pasang ke Pad [${pendingPadPickerSlot + 1}]`;

      row.appendChild(info);
      row.appendChild(assignBtn);

      row.addEventListener('click', () => {
        assignFileToCuePad(fileObj, pendingPadPickerSlot);
        closePadPickerModal();
      });

      fragment.appendChild(row);
    });

    padPickerList.appendChild(fragment);
  }

  if (btnClosePadPicker) btnClosePadPicker.addEventListener('click', closePadPickerModal);
  if (btnCancelPadPicker) btnCancelPadPicker.addEventListener('click', closePadPickerModal);
  if (padPickerModal) {
    padPickerModal.addEventListener('click', e => {
      if (e.target === padPickerModal) closePadPickerModal();
    });
  }
  if (padPickerSearchInput) {
    padPickerSearchInput.addEventListener('input', () => {
      renderPadPickerTrackList(padPickerSearchInput.value);
    });
  }
  if (btnPickActiveDeckTrack) {
    btnPickActiveDeckTrack.addEventListener('click', () => {
      if (activeTrackObj) {
        assignFileToCuePad(activeTrackObj, pendingPadPickerSlot);
        closePadPickerModal();
      }
    });
  }

  if (btnToggleCuePads) {
    btnToggleCuePads.addEventListener('click', () => {
      cuePadsCollapsed = !cuePadsCollapsed;
      syncCuePadsCollapseUI();
      savePlayerPrefs();
    });
  }

  if (btnAssignCurrentToPad) {
    btnAssignCurrentToPad.addEventListener('click', () => {
      if (!activeTrackObj) {
        notify({
          type: 'info',
          title: 'Belum Ada Lagu Aktif',
          message: 'Pilih atau putar lagu terlebih dahulu sebelum menyimpannya ke Cue Pad.',
        });
        return;
      }
      assignFileToCuePad(activeTrackObj);
    });
  }

  if (btnClearAllPads) {
    btnClearAllPads.addEventListener('click', () => {
      cuePads = Array(8).fill(null);
      saveCuePads();
      renderCuePads();
      if (isRemoteController) {
        sendRemoteCommand('clear_pad', { all: true });
      }
      notify({
        type: 'info',
        title: 'Cue Pads Direset',
        message: 'Seluruh slot Instant Cue Pad 1–8 telah dikosongkan.',
        duration: 2400,
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 8. Library Fetching, Filtering & Setlist Table Rendering
  // ---------------------------------------------------------------------------
  function syncSourceLocationUI() {
    const isDefault =
      !currentSourceDir ||
      (defaultInboxDir && currentSourceDir === defaultInboxDir) ||
      currentSourceDir.endsWith('/library/inbox') ||
      currentSourceDir.endsWith('\\library\\inbox');
    if (activeSourceBadge) {
      activeSourceBadge.textContent = isDefault
        ? 'library/inbox (Koleksi Default Aplikasi)'
        : currentSourceDir;
      activeSourceBadge.title = currentSourceDir || 'library/inbox';
    }
    if (btnResetInbox) {
      btnResetInbox.classList.toggle('hidden', isDefault || isRemoteController);
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
        title: 'Gagal Memuat Koleksi Audio',
        message: error || 'Tidak dapat membaca direktori sumber.',
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

    renderPlaylists();
    applyFiltersAndRenderTable();

    if (isRemoteController) {
      return true;
    }

    // Restore previously active track (including exact playback position & playing state) or cue first song automatically
    if (activeTrackRelPath) {
      const restored = allFiles.find(f => f.rel_path === activeTrackRelPath);
      if (restored && (!activeTrackObj || activeTrackObj.rel_path !== restored.rel_path)) {
        const savedSession = !hasRestoredInitialSession ? loadPlaybackSessionState() : null;
        hasRestoredInitialSession = true;
        const isMatchingSession = Boolean(
          savedSession && savedSession.rel_path === restored.rel_path
        );
        const resumeTime = isMatchingSession ? savedSession.currentTime : 0;
        const shouldAutoPlay = isMatchingSession ? Boolean(savedSession.isPlaying) : false;
        loadTrack(restored, shouldAutoPlay, {
          startTime: resumeTime,
          isSessionRestore: true,
        });
      } else if (restored) {
        activeTrackObj = restored;
        updateNowPlayingCard(restored);
      }
    } else if (!activeTrackObj && visibleFiles.length > 0) {
      hasRestoredInitialSession = true;
      loadTrack(visibleFiles[0], false);
    }

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
      createPlaylistCard('ALL', 'Semua Lagu', `${totalSongs} tracks`, `${totalMp3} MP3`)
    );

    allPlaylists.forEach(pl => {
      const displayLabel = pl.label ? pl.label.replace(/^📁\s*/, '') : pl.name;
      const subText = `${pl.total} tracks`;
      const badgeText = pl.mp3_count > 0 ? `${pl.mp3_count} MP3` : `${pl.other_count} Native`;
      fragment.appendChild(createPlaylistCard(pl.name, displayLabel, subText, badgeText));
    });

    playlistGrid.appendChild(fragment);

    // Sync Mobile / Quick Dropdown Selector
    if (playlistSelectDropdown) {
      playlistSelectDropdown.replaceChildren();
      const allOpt = document.createElement('option');
      allOpt.value = 'ALL';
      allOpt.textContent = `📁 Semua Lagu (${totalSongs})`;
      allOpt.selected = activePlaylist === 'ALL';
      playlistSelectDropdown.appendChild(allOpt);

      allPlaylists.forEach(pl => {
        const displayLabel = pl.label ? pl.label.replace(/^📁\s*/, '') : pl.name;
        const opt = document.createElement('option');
        opt.value = pl.name;
        opt.textContent = `📁 ${displayLabel} (${pl.total} Lagu)`;
        opt.selected = activePlaylist === pl.name;
        playlistSelectDropdown.appendChild(opt);
      });
      playlistSelectDropdown.value = activePlaylist || 'ALL';
    }
  }

  function createPlaylistCard(id, title, countText, badgeText) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'playlist-card' + (activePlaylist === id ? ' active' : '');

    const topRow = document.createElement('div');
    topRow.className = 'playlist-card-top';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'playlist-card-title';
    titleSpan.textContent = title;
    titleSpan.title = title;

    const badgeSpan = document.createElement('span');
    badgeSpan.className = 'playlist-card-badge';
    badgeSpan.textContent = badgeText;

    topRow.appendChild(titleSpan);
    topRow.appendChild(badgeSpan);

    const subSpan = document.createElement('span');
    subSpan.className = 'playlist-card-sub';
    subSpan.textContent = countText;

    btn.appendChild(topRow);
    btn.appendChild(subSpan);

    btn.addEventListener('click', () => {
      activePlaylist = id;
      if (playlistSelectDropdown) playlistSelectDropdown.value = id;
      renderPlaylists();
      applyFiltersAndRenderTable();
      persistWorkspaceState();
      if (isRemoteController) {
        sendRemoteCommand('select_playlist', { playlist: id });
      }
    });
    return btn;
  }

  function applyFiltersAndRenderTable() {
    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();
    const qcFilter = filterQcStatus ? filterQcStatus.value : 'ALL';
    const fmtFilter = filterFormat ? filterFormat.value : 'ALL';
    const groupMode = groupByMode ? groupByMode.value : 'folder';

    visibleFiles = allFiles.filter(f => {
      if (activePlaylist === '__ROOT__' && f.folder !== '') return false;
      if (activePlaylist !== 'ALL' && activePlaylist !== '__ROOT__' && f.folder !== activePlaylist) {
        return false;
      }
      if (fmtFilter !== 'ALL' && (f.ext || '').toLowerCase() !== fmtFilter) {
        return false;
      }
      if (query) {
        const hay = `${f.name} ${f.folder || ''} ${f.ext || ''}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      if (qcFilter !== 'ALL') {
        const qc = f.qc || {};
        const tp = qc.true_peak_dbtp !== undefined && qc.true_peak_dbtp !== '' ? parseFloat(qc.true_peak_dbtp) : NaN;
        if (qcFilter === 'SAFE' && (Number.isNaN(tp) || tp > -1.0 || qc.spectral_status === 'FAKE_HQ')) return false;
        if (qcFilter === 'TRIM' && (Number.isNaN(tp) || tp <= -1.0 || tp > 0.0)) return false;
        if (qcFilter === 'CLIPPING' && (Number.isNaN(tp) || tp <= 0.0)) return false;
        if (qcFilter === 'FAKE_HQ' && qc.spectral_status !== 'FAKE_HQ') return false;
      }
      return true;
    });

    if (playerCountSummary) {
      playerCountSummary.textContent = `${visibleFiles.length} / ${allFiles.length} tracks ready`;
    }

    renderSetlistTable(visibleFiles, groupMode);
  }

  function renderSetlistTable(files, groupMode) {
    if (!playerTableBody) return;
    playerTableBody.replaceChildren();
    groupDomMap.clear();
    rowDomByRelPath.clear();

    if (files.length === 0) {
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      const td = document.createElement('td');
      td.colSpan = 8;
      td.textContent = 'No audio tracks match the current filter criteria.';
      tr.appendChild(td);
      playerTableBody.appendChild(tr);
      return;
    }

    const groups = groupFiles(files, groupMode);
    const fragment = document.createDocumentFragment();
    let globalIndex = 1;

    groups.forEach(group => {
      const isCollapsed = collapsedGroups.has(group.key);
      const groupTr = document.createElement('tr');
      groupTr.className = 'group-header-row';

      const groupTd = document.createElement('td');
      groupTd.colSpan = 8;

      const { bar, chevron, toggleHint } = createGroupHeaderBar(group, isCollapsed, {
        onOpenExplorer: isRemoteController
          ? null
          : g => openFolderInExplorer(g.folderPath, currentSourceDir),
      });

      groupTd.appendChild(bar);
      groupTr.appendChild(groupTd);

      const childRows = [];
      groupTr.addEventListener('click', () => {
        groupCollapseCtrl.toggleGroup(group.key);
      });

      fragment.appendChild(groupTr);

      group.files.forEach(fileObj => {
        const tr = createPlayerTrackRow(fileObj, globalIndex++, groupMode !== 'folder');
        if (isCollapsed) tr.classList.add('group-row-hidden');
        childRows.push(tr);
        rowDomByRelPath.set(fileObj.rel_path, tr);
        fragment.appendChild(tr);
      });

      groupDomMap.set(group.key, { chevron, toggleHint, childRows });
    });

    playerTableBody.appendChild(fragment);
    highlightActiveRowInTable();
  }

  function createPlayerTrackRow(fileObj, trackIdx, showFolderBadge) {
    const tr = document.createElement('tr');
    tr.draggable = true;
    tr.addEventListener('dragstart', e => {
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', fileObj.rel_path);
        e.dataTransfer.effectAllowed = 'copy';
      }
    });
    const qc = fileObj.qc || {};

    // Column 1: Play / Cue / Pad Actions
    const tdActions = document.createElement('td');
    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'row-play-actions';

    const btnPlay = document.createElement('button');
    btnPlay.type = 'button';
    btnPlay.className = 'btn-row-play';
    btnPlay.textContent = isRemoteController ? '▶' : '▶ Play';
    btnPlay.title = 'Putar lagu ini di Master Deck';
    btnPlay.addEventListener('click', e => {
      e.stopPropagation();
      if (activeTrackObj && activeTrackObj.rel_path === fileObj.rel_path && isDeckPlaying()) {
        pauseCurrentTrack();
      } else {
        loadTrack(fileObj, true);
      }
    });

    const btnCue = document.createElement('button');
    btnCue.type = 'button';
    btnCue.className = 'btn-row-cue';
    btnCue.textContent = 'Cue';
    btnCue.title = 'Load track to Master Deck at 00:00.0 Cue Point (Standby)';
    btnCue.addEventListener('click', e => {
      e.stopPropagation();
      if (!isRemoteController && audioEl && !audioEl.paused) {
        audioEl.pause();
      }
      loadTrack(fileObj, false);
    });

    const btnPad = document.createElement('button');
    btnPad.type = 'button';
    const existingPadIdx = cuePads.findIndex(p => p && p.rel_path === fileObj.rel_path);
    btnPad.className = 'btn-row-pad' + (existingPadIdx >= 0 ? ' assigned' : '');
    btnPad.textContent = existingPadIdx >= 0 ? `Pad [${existingPadIdx + 1}] ✓` : '+ Pad';
    btnPad.title =
      existingPadIdx >= 0
        ? `Terpasang di Cue Pad [${existingPadIdx + 1}] — Klik untuk melepas dari Pad`
        : 'Pasang track ini ke slot Instant Cue Pad kosong berikutnya';
    btnPad.addEventListener('click', e => {
      e.stopPropagation();
      const curIdx = cuePads.findIndex(p => p && p.rel_path === fileObj.rel_path);
      if (curIdx >= 0) {
        cuePads[curIdx] = null;
        saveCuePads();
        renderCuePads();
        if (isRemoteController) {
          sendRemoteCommand('clear_pad', { index: curIdx });
        }
        notify({
          type: 'info',
          title: `Dilepas dari Cue Pad [${curIdx + 1}]`,
          message: `"${fileObj.name}" telah dihapus dari slot Pad [${curIdx + 1}].`,
          duration: 2200,
        });
      } else {
        assignFileToCuePad(fileObj);
      }
    });

    actionsWrap.appendChild(btnPlay);
    actionsWrap.appendChild(btnCue);
    actionsWrap.appendChild(btnPad);
    tdActions.appendChild(actionsWrap);

    // Column 2: File Name Cell
    const tdName = createFileNameCell(fileObj, {
      index: trackIdx,
      showFolderBadge,
    });
    if (isRemoteController) {
      tdName.style.cursor = 'pointer';
      tdName.title = 'Ketuk untuk Cue lagu ini ke Master Deck';
      tdName.addEventListener('click', () => loadTrack(fileObj, false));
    }

    // Column 3: Codec & Sample Rate
    const tdCodec = document.createElement('td');
    tdCodec.className = 'mono-cell';
    const extLabel = (fileObj.ext || '').replace('.', '').toUpperCase();
    const srText = qc.sample_rate_hz ? ` • ${(Number(qc.sample_rate_hz) / 1000).toFixed(1)} kHz` : '';
    tdCodec.textContent = `${extLabel}${srText} (${fileObj.size_mb} MB)`;

    // Column 4: Spectral Quality
    const tdSpec = document.createElement('td');
    const specBadge = createSpectralBadge(qc);
    if (specBadge) {
      tdSpec.appendChild(specBadge);
    } else {
      tdSpec.className = 'mono-cell text-muted';
      tdSpec.textContent = '—';
    }

    // Column 5: True Peak (dBTP)
    const tdTp = document.createElement('td');
    tdTp.className = 'mono-cell';
    const hasTp = qc.true_peak_dbtp !== undefined && qc.true_peak_dbtp !== '';
    if (hasTp) {
      const tpVal = parseFloat(qc.true_peak_dbtp);
      tdTp.textContent = `${tpVal > 0 ? '+' : ''}${tpVal.toFixed(1)} dBTP`;
      if (tpVal > 0) tdTp.classList.add('val-danger');
      else if (tpVal > -1.0) tdTp.classList.add('val-warn');
      else tdTp.classList.add('val-safe');
    } else {
      tdTp.textContent = '—';
    }

    // Column 6: Integrated LUFS
    const tdLufs = document.createElement('td');
    tdLufs.className = 'mono-cell';
    const hasLufs = qc.integrated_lufs !== undefined && qc.integrated_lufs !== '';
    tdLufs.textContent = hasLufs ? `${parseFloat(qc.integrated_lufs).toFixed(1)} LUFS` : '—';

    // Column 7: Recommended Auto-Trim
    const tdTrim = document.createElement('td');
    tdTrim.className = 'mono-cell';
    const autoTrimDb = computeRecommendedAutoTrimDb(fileObj);
    tdTrim.textContent = hasTp || hasLufs ? `${autoTrimDb.toFixed(1)} dB` : '0.0 dB';

    // Column 8: FOH Status Badge
    const tdStatus = document.createElement('td');
    const statusBadge = document.createElement('span');
    const rawStatus = String(qc.soundsystem_status || 'UNTESTED');
    if (rawStatus.includes('CLIPPING') || qc.spectral_status === 'FAKE_HQ') {
      statusBadge.className = 'status-badge danger';
      statusBadge.textContent = qc.spectral_status === 'FAKE_HQ' ? 'FAKE HQ' : 'CLIPPING';
    } else if (rawStatus.includes('TRIM')) {
      statusBadge.className = 'status-badge warning';
      statusBadge.textContent = 'PREAMP TRIM';
    } else if (rawStatus.includes('READY')) {
      statusBadge.className = 'status-badge safe';
      statusBadge.textContent = 'FOH READY';
    } else {
      statusBadge.className = 'status-badge neutral';
      statusBadge.textContent = 'UNPROBED';
    }
    tdStatus.appendChild(statusBadge);

    tr.appendChild(tdActions);
    tr.appendChild(tdName);
    tr.appendChild(tdCodec);
    tr.appendChild(tdSpec);
    tr.appendChild(tdTp);
    tr.appendChild(tdLufs);
    tr.appendChild(tdTrim);
    tr.appendChild(tdStatus);

    tr.addEventListener('dblclick', () => loadTrack(fileObj, true));
    return tr;
  }

  function highlightActiveRowInTable() {
    const isPlaying = isDeckPlaying();
    rowDomByRelPath.forEach((tr, relPath) => {
      const isActive = Boolean(activeTrackObj && activeTrackObj.rel_path === relPath);
      tr.classList.toggle('is-active-track', isActive && !isPlaying);
      tr.classList.toggle('is-playing-track', isActive && isPlaying);
      const playBtn = tr.querySelector('.btn-row-play');
      if (playBtn) {
        playBtn.classList.toggle('active', isActive && isPlaying);
        if (isRemoteController) {
          playBtn.textContent = isActive && isPlaying ? '❚❚' : '▶';
        } else {
          playBtn.textContent = isActive && isPlaying ? '❚❚ Pause' : '▶ Play';
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 9. UI Controls & Keyboard Shortcuts Binding
  // ---------------------------------------------------------------------------
  if (btnPlayPause) {
    btnPlayPause.addEventListener('click', () => {
      if (isRemoteController) {
        sendRemoteCommand('play_pause');
        return;
      }
      if (audioEl && !audioEl.paused) {
        pauseCurrentTrack();
      } else {
        playCurrentTrack();
      }
    });
  }

  if (btnStopReset) {
    btnStopReset.addEventListener('click', stopAndResetCue);
  }

  if (btnPrevTrack) {
    btnPrevTrack.addEventListener('click', () => {
      if (isRemoteController) {
        sendRemoteCommand('prev');
        return;
      }
      const prev = getAdjacentTrack(-1);
      if (prev) {
        const shouldPlay = Boolean(audioEl && !audioEl.paused);
        loadTrack(prev, shouldPlay);
      }
    });
  }

  if (btnNextTrack) {
    btnNextTrack.addEventListener('click', () => {
      if (isRemoteController) {
        sendRemoteCommand('next');
        return;
      }
      const next = getAdjacentTrack(1);
      if (next) {
        const shouldPlay = Boolean(audioEl && !audioEl.paused);
        loadTrack(next, shouldPlay);
      }
    });
  }

  if (btnFadeOut3) {
    btnFadeOut3.addEventListener('click', () => triggerSmoothFadeOut(3.0));
  }
  if (btnFadeOut5) {
    btnFadeOut5.addEventListener('click', () => triggerSmoothFadeOut(5.0));
  }

  function nudgeSeek(deltaSec) {
    if (isRemoteController) {
      sendRemoteCommand('nudge', { delta: deltaSec });
      return;
    }
    if (!audioEl || !Number.isFinite(audioEl.duration)) return;
    audioEl.currentTime = Math.max(0, Math.min(audioEl.duration, audioEl.currentTime + deltaSec));
    updateTimecodeUI();
  }

  if (btnCueZero) {
    btnCueZero.addEventListener('click', () => {
      if (isRemoteController) {
        sendRemoteCommand('cue_zero');
        return;
      }
      if (!audioEl) return;
      audioEl.currentTime = 0;
      updateTimecodeUI();
    });
  }
  if (btnSeekBack10) btnSeekBack10.addEventListener('click', () => nudgeSeek(-10));
  if (btnSeekBack5) btnSeekBack5.addEventListener('click', () => nudgeSeek(-5));
  if (btnSeekFwd5) btnSeekFwd5.addEventListener('click', () => nudgeSeek(5));
  if (btnSeekFwd10) btnSeekFwd10.addEventListener('click', () => nudgeSeek(10));

  if (seekSlider) {
    seekSlider.addEventListener('input', () => {
      isSeeking = true;
      lastLocalControlTouchAt = Date.now();
      const dur = isRemoteController
        ? remoteDuration
        : audioEl && Number.isFinite(audioEl.duration)
          ? audioEl.duration
          : 0;
      if (dur > 0) {
        const targetSec = (Number(seekSlider.value) / 1000) * dur;
        if (timeElapsed) timeElapsed.textContent = formatTimecode(targetSec, true);
      }
    });
    seekSlider.addEventListener('change', () => {
      const ratio = Math.max(0, Math.min(1, Number(seekSlider.value) / 1000));
      if (isRemoteController) {
        isSeeking = false;
        sendRemoteCommand('seek_ratio', { ratio });
        return;
      }
      if (audioEl && Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
        audioEl.currentTime = ratio * audioEl.duration;
      }
      isSeeking = false;
      updateTimecodeUI();
    });
  }

  // Play Mode Buttons
  function setPlayMode(newMode, opts = {}) {
    playMode = newMode;
    if (modeBtnCue) modeBtnCue.classList.toggle('active', playMode === 'cue');
    if (modeBtnContinuous) modeBtnContinuous.classList.toggle('active', playMode === 'continuous');
    if (modeBtnLoop) modeBtnLoop.classList.toggle('active', playMode === 'loop');

    if (activePlayModeBadge) {
      if (playMode === 'cue') activePlayModeBadge.textContent = 'CUE (AUTO-STOP)';
      else if (playMode === 'continuous') activePlayModeBadge.textContent = 'CONTINUOUS';
      else activePlayModeBadge.textContent = 'LOOP 1 TRACK';
    }
    savePlayerPrefs();
    if (isRemoteController && !opts.fromRemoteSync) {
      sendRemoteCommand('set_play_mode', { mode: newMode });
    }
  }

  if (modeBtnCue) modeBtnCue.addEventListener('click', () => setPlayMode('cue'));
  if (modeBtnContinuous) modeBtnContinuous.addEventListener('click', () => setPlayMode('continuous'));
  if (modeBtnLoop) modeBtnLoop.addEventListener('click', () => setPlayMode('loop'));

  // Tabbed / Collapsible DSP Rack
  function syncDspRackTabsUI() {
    const isCollapsed = !activeDspTab;
    if (dspRackBody) {
      dspRackBody.classList.toggle('collapsed', isCollapsed);
    }
    dspRackTabs.forEach(tab => {
      const isThisActive = tab.dataset.dspTab === activeDspTab;
      tab.classList.toggle('active', isThisActive);
      tab.setAttribute('aria-selected', String(isThisActive));
    });
    dspRackPanes.forEach(pane => {
      pane.classList.toggle('hidden', pane.dataset.dspPane !== activeDspTab);
    });
  }

  dspRackTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const key = tab.dataset.dspTab || '';
      activeDspTab = activeDspTab === key ? '' : key;
      syncDspRackTabsUI();
    });
  });

  // Channel Routing Matrix Buttons
  routingButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      routingMode = btn.dataset.route || 'stereo';
      routingButtons.forEach(b => b.classList.toggle('active', b === btn));
      if (isRemoteController) {
        syncRoutingBadgeUI();
        sendRemoteCommand('set_routing', { mode: routingMode });
        return;
      }
      ensureAudioGraph();
      applyRoutingMatrix();
    });
  });

  if (btnResetPeak) {
    btnResetPeak.addEventListener('click', () => {
      maxPeakHoldDb = -Infinity;
      updatePeakBadge();
      if (isRemoteController) {
        sendRemoteCommand('reset_peak');
      }
    });
  }

  // Gain, Mute, Preamp & EQ Sliders
  if (volumeSlider) {
    volumeSlider.addEventListener('input', () => {
      lastLocalControlTouchAt = Date.now();
      isMuted = false;
      if (btnMute) {
        btnMute.textContent = 'Mute';
        btnMute.classList.remove('active');
      }
      applyGainAndEqNodes();
      savePlayerPrefs();
      if (isRemoteController) {
        sendThrottledRemoteCommand('set_volume', { volume: Number(volumeSlider.value) }, 60);
      }
    });
    volumeSlider.addEventListener('change', () => {
      if (isRemoteController) {
        flushThrottledRemoteCommand('set_volume', { volume: Number(volumeSlider.value) });
      }
    });
  }
  if (btnMute) {
    btnMute.addEventListener('click', () => {
      lastLocalControlTouchAt = Date.now();
      isMuted = !isMuted;
      btnMute.textContent = isMuted ? 'Unmute' : 'Mute';
      btnMute.classList.toggle('active', isMuted);
      applyGainAndEqNodes();
      if (isRemoteController) {
        sendRemoteCommand('toggle_mute', { is_muted: isMuted });
      }
    });
  }
  if (preampSlider) {
    preampSlider.addEventListener('input', () => {
      lastLocalControlTouchAt = Date.now();
      if (!isRemoteController) ensureAudioGraph();
      applyGainAndEqNodes();
      if (isRemoteController) {
        sendThrottledRemoteCommand('set_preamp', { preamp_db: Number(preampSlider.value) }, 60);
      }
    });
    preampSlider.addEventListener('change', () => {
      if (isRemoteController) {
        flushThrottledRemoteCommand('set_preamp', { preamp_db: Number(preampSlider.value) });
      }
    });
  }
  if (btnResetPreamp && preampSlider) {
    btnResetPreamp.addEventListener('click', () => {
      lastLocalControlTouchAt = Date.now();
      preampSlider.value = '0';
      applyGainAndEqNodes();
      if (isRemoteController) {
        sendRemoteCommand('set_preamp', { preamp_db: 0 });
      }
    });
  }
  [eqLowSlider, eqMidSlider, eqHighSlider].forEach(slider => {
    if (slider) {
      slider.addEventListener('input', () => {
        lastLocalControlTouchAt = Date.now();
        if (!isRemoteController) ensureAudioGraph();
        applyGainAndEqNodes();
        if (isRemoteController) {
          sendThrottledRemoteCommand('set_eq', {
            low_db: eqLowSlider ? Number(eqLowSlider.value) : 0,
            mid_db: eqMidSlider ? Number(eqMidSlider.value) : 0,
            high_db: eqHighSlider ? Number(eqHighSlider.value) : 0,
          }, 60);
        }
      });
      slider.addEventListener('change', () => {
        if (isRemoteController) {
          flushThrottledRemoteCommand('set_eq', {
            low_db: eqLowSlider ? Number(eqLowSlider.value) : 0,
            mid_db: eqMidSlider ? Number(eqMidSlider.value) : 0,
            high_db: eqHighSlider ? Number(eqHighSlider.value) : 0,
          });
        }
      });
    }
  });
  if (btnResetEq) {
    btnResetEq.addEventListener('click', () => {
      lastLocalControlTouchAt = Date.now();
      if (eqLowSlider) eqLowSlider.value = '0';
      if (eqMidSlider) eqMidSlider.value = '0';
      if (eqHighSlider) eqHighSlider.value = '0';
      applyGainAndEqNodes();
      if (isRemoteController) {
        sendRemoteCommand('reset_eq');
      }
    });
  }
  if (chkAutoTrim) {
    chkAutoTrim.addEventListener('change', () => {
      lastLocalControlTouchAt = Date.now();
      if (chkAutoTrim.checked && activeTrackObj && preampSlider) {
        preampSlider.value = String(computeRecommendedAutoTrimDb(activeTrackObj));
      } else if (!chkAutoTrim.checked && preampSlider) {
        preampSlider.value = '0';
      }
      applyGainAndEqNodes();
      if (activeTrackObj) updateNowPlayingCard(activeTrackObj);
      savePlayerPrefs();
      if (isRemoteController) {
        sendRemoteCommand('set_autotrim', { enabled: Boolean(chkAutoTrim.checked) });
      }
    });
  }

  // Filter & Search Listeners
  if (playlistSelectDropdown) {
    playlistSelectDropdown.addEventListener('change', () => {
      activePlaylist = playlistSelectDropdown.value;
      renderPlaylists();
      applyFiltersAndRenderTable();
      persistWorkspaceState();
      if (isRemoteController) {
        sendRemoteCommand('select_playlist', { playlist: activePlaylist });
      }
    });
  }
  let searchDebounceTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(applyFiltersAndRenderTable, 120);
    });
  }
  if (groupByMode) groupByMode.addEventListener('change', applyFiltersAndRenderTable);
  if (filterQcStatus) filterQcStatus.addEventListener('change', applyFiltersAndRenderTable);
  if (filterFormat) filterFormat.addEventListener('change', applyFiltersAndRenderTable);

  if (btnOpenExplorer) {
    btnOpenExplorer.addEventListener('click', () => {
      const sub = activePlaylist !== 'ALL' && activePlaylist !== '__ROOT__' ? activePlaylist : '';
      openFolderInExplorer(sub, currentSourceDir);
    });
  }

  if (btnResetInbox) {
    btnResetInbox.addEventListener('click', () => {
      currentSourceDir = '';
      activePlaylist = 'ALL';
      fetchLibrary('');
    });
  }

  if (btnQuickAuditSetlist) {
    btnQuickAuditSetlist.addEventListener('click', async () => {
      if (isAuditRunning) return;
      isAuditRunning = true;
      btnQuickAuditSetlist.disabled = true;
      if (btnQuickAuditText) btnQuickAuditText.textContent = 'Scanning LUFS & dBTP...';

      const { ok, error } = await apiPost('/api/scan', { source_dir: currentSourceDir });
      isAuditRunning = false;
      btnQuickAuditSetlist.disabled = false;
      if (btnQuickAuditText) btnQuickAuditText.textContent = 'QC Audit & Auto-Trim';

      if (ok) {
        await fetchLibrary(currentSourceDir);
        notify({
          type: 'success',
          title: 'QC Audit & Auto-Trim Complete',
          message: 'All tracks analyzed for True Peak (dBTP), Integrated LUFS & FOH Headroom.',
        });
      } else {
        notify({
          type: 'error',
          title: 'QC Audit Failed',
          message: error || 'Check FFmpeg installation.',
        });
      }
    });
  }

  // Folder Browser Modal Initialization
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
    getStartPath: () => currentSourceDir || defaultInboxDir,
    onSelectSource: selectedPath => {
      currentSourceDir = selectedPath;
      activePlaylist = 'ALL';
      fetchLibrary(selectedPath);
    },
    onSelectDest: () => {},
    onLog: () => {},
  });

  // Unlock Web Audio API Graph & Auto-Resume on first user interaction after refresh
  function unlockAudioContextAndResumeOnGesture() {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx
        .resume()
        .then(() => {
          connectMediaElementToGraphIfReady();
        })
        .catch(() => {});
    } else {
      connectMediaElementToGraphIfReady();
    }
    if (pendingAutoResumeOnGesture) {
      pendingAutoResumeOnGesture = false;
      playCurrentTrack();
    }
  }
  window.addEventListener('pointerdown', unlockAudioContextAndResumeOnGesture, { capture: true });
  window.addEventListener('keydown', unlockAudioContextAndResumeOnGesture, { capture: true });

  // Global FOH Keyboard Shortcuts (Space, F, S, 1-8, Escape)
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && remoteModal && !remoteModal.classList.contains('hidden')) {
      e.preventDefault();
      closeRemoteModal();
      return;
    }
    if (e.key === 'Escape' && padPickerModal && !padPickerModal.classList.contains('hidden')) {
      e.preventDefault();
      closePadPickerModal();
      return;
    }
    const tag = (e.target && e.target.tagName ? e.target.tagName : '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.code === 'Space') {
      e.preventDefault();
      if (isDeckPlaying()) {
        pauseCurrentTrack();
      } else {
        playCurrentTrack();
      }
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      triggerSmoothFadeOut(3.0);
    } else if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      stopAndResetCue();
    } else if (e.key >= '1' && e.key <= '8') {
      e.preventDefault();
      const padIdx = parseInt(e.key, 10) - 1;
      triggerCuePad(padIdx);
    }
  });

  // ---------------------------------------------------------------------------
  // 10. FOH Wireless Mobile Remote Engine (Master <-> HP Two-Way Sync)
  // ---------------------------------------------------------------------------
  function syncRemotePinButtonText() {
    if (remotePinBtnText) {
      remotePinBtnText.textContent = remotePin ? `PIN: ${remotePin}` : 'Masukkan PIN';
    }
  }

  let currentRemoteServerPort = 8765;
  let latestWslPowerShellCmd = '';

  function renderQrForRemoteUrl(targetUrl, labelHint = '') {
    if (!remoteQrCanvas) return;
    const ok = renderQrToCanvas(remoteQrCanvas, targetUrl, { sizePx: 180, margin: 3 });
    if (remoteQrCaption) {
      if (ok) {
        try {
          const parsed = new URL(targetUrl);
          remoteQrCaption.textContent = labelHint
            ? `${parsed.hostname} (${labelHint})`
            : `Scan QR (${parsed.host})`;
        } catch (_e) {
          remoteQrCaption.textContent = 'Scan QR dengan Kamera HP';
        }
      } else {
        remoteQrCaption.textContent = 'Menunggu IP Wi-Fi...';
      }
    }
  }

  const btnDisableWslBridge = document.getElementById('btnDisableWslBridge');
  function renderWslBridgeStatusUI(wslInfo) {
    if (!remoteWslBridgeBox) return;
    if (!wslInfo || !wslInfo.is_wsl) {
      remoteWslBridgeBox.classList.add('hidden');
      return;
    }
    remoteWslBridgeBox.classList.remove('hidden');
    latestWslPowerShellCmd = wslInfo.powershell_admin_cmd || '';
    const isActive = Boolean(wslInfo.bridge_active);
    remoteWslBridgeBox.classList.toggle('active', isActive);
    if (btnDisableWslBridge) {
      btnDisableWslBridge.classList.toggle('hidden', !isActive);
    }

    if (isActive) {
      if (remoteWslBridgeTitle) {
        remoteWslBridgeTitle.textContent = `✓ Jembatan Port Windows -> WSL2 (${wslInfo.wsl_ip || 'Aktif'}) Sudah Terbuka`;
      }
      if (remoteWslBridgeDesc) {
        remoteWslBridgeDesc.textContent =
          'Hanya TCP Port 8765 yang diteruskan ke WSL2 (dilindungi PIN 4-Digit & LAN Gate). Anda dapat menekan "Tutup Port" kapan saja setelah selesai manggung.';
      }
      if (btnEnableWslBridgeText) {
        btnEnableWslBridgeText.textContent = 'Perbarui Bridge WSL2';
      }
    } else {
      if (remoteWslBridgeTitle) {
        remoteWslBridgeTitle.textContent =
          '⚠️ Mode WSL2 Terdeteksi: Akses dari HP Memerlukan Jembatan Port Windows';
      }
      if (remoteWslBridgeDesc) {
        remoteWslBridgeDesc.textContent = `Aplikasi berjalan di dalam WSL2 (IP virtual internal: ${wslInfo.wsl_ip || '172.x.x.x'}). Agar HP di Wi-Fi bisa membuka player ini, klik tombol "Aktifkan Akses HP (1-Klik)" lalu klik Yes pada jendela konfirmasi Windows.`;
      }
      if (btnEnableWslBridgeText) {
        btnEnableWslBridgeText.textContent = 'Aktifkan Akses HP (1-Klik)';
      }
    }
  }

  function renderRemoteUrlItems(interfacesList, fallbackUrls, pinCode) {
    if (!remoteUrlList) return;
    remoteUrlList.replaceChildren();

    const items =
      Array.isArray(interfacesList) && interfacesList.length > 0
        ? interfacesList
        : (fallbackUrls || []).map(u => ({
            url: u,
            label: 'Jaringan Lokal',
            reachable_from_hp: true,
          }));

    if (items.length === 0) {
      const fallbackSimUrl = `${window.location.origin}/player?remote=1&pin=${encodeURIComponent(pinCode || remotePin || '')}`;
      renderQrForRemoteUrl(fallbackSimUrl, 'Simulasi Lokal');

      const emptyItem = document.createElement('div');
      emptyItem.className = 'remote-url-item';
      const msg = document.createElement('span');
      msg.className = 'remote-url-code';
      msg.textContent =
        'Belum terdeteksi IP Wi-Fi/Hotspot otomatis. Ketik IP Wi-Fi Laptop Anda pada kolom manual di bawah atau klik Refresh IP.';
      emptyItem.appendChild(msg);
      remoteUrlList.appendChild(emptyItem);
      return;
    }

    const firstItem = items[0];
    renderQrForRemoteUrl(
      firstItem.url,
      firstItem.reachable_from_hp ? 'Wi-Fi / LAN' : 'WSL2 Internal'
    );

    items.forEach((item, idx) => {
      const fullUrl = item.url;
      const row = document.createElement('div');
      row.className = 'remote-url-item' + (idx === 0 ? ' active' : '');
      row.title = 'Klik untuk menampilkan alamat IP ini pada QR Code';

      const leftCol = document.createElement('div');
      leftCol.className = 'remote-url-item-left';

      const badgeEl = document.createElement('span');
      badgeEl.className =
        'remote-url-badge' + (item.reachable_from_hp === false ? ' warn' : '');
      badgeEl.textContent = item.label || 'Jaringan Lokal';

      const codeEl = document.createElement('code');
      codeEl.className = 'remote-url-code';
      codeEl.textContent = fullUrl;

      leftCol.appendChild(badgeEl);
      leftCol.appendChild(codeEl);

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn-nudge';
      copyBtn.textContent = 'Salin Link';
      copyBtn.addEventListener('click', async e => {
        e.stopPropagation();
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(fullUrl);
            copyBtn.textContent = 'Tersalin ✓';
            setTimeout(() => {
              copyBtn.textContent = 'Salin Link';
            }, 1800);
          }
        } catch (_e) {
          // Ignore clipboard errors
        }
      });

      row.addEventListener('click', () => {
        Array.from(remoteUrlList.querySelectorAll('.remote-url-item')).forEach(el => {
          el.classList.remove('active');
        });
        row.classList.add('active');
        renderQrForRemoteUrl(
          fullUrl,
          item.reachable_from_hp === false ? 'WSL2 Internal' : 'Wi-Fi / LAN'
        );
      });

      row.appendChild(leftCol);
      row.appendChild(copyBtn);
      remoteUrlList.appendChild(row);
    });
  }

  let lastRenderedClientsSig = '';
  function renderConnectedRemoteClients(activeList = [], blockedList = [], forceRender = false) {
    if (!remoteClientsList) return;
    const safeActive = Array.isArray(activeList) ? activeList : [];
    const safeBlocked = Array.isArray(blockedList) ? blockedList : [];

    // Signature excluding idle_seconds so DOM buttons aren't recreated every 350ms while user hovers/clicks
    const sigObj = {
      a: safeActive.map(c => `${c.client_id}:${c.role}:${c.commands_sent || 0}:${c.ip}:${c.label}`),
      b: safeBlocked.map(b => `${b.client_id}:${b.ip}:${b.label}`),
    };
    const sig = JSON.stringify(sigObj);
    if (!forceRender && sig === lastRenderedClientsSig) {
      return;
    }
    lastRenderedClientsSig = sig;

    if (btnKickAllRemotes) {
      btnKickAllRemotes.classList.toggle('hidden', safeActive.length === 0);
    }

    remoteClientsList.replaceChildren();
    if (safeActive.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'remote-client-empty';
      emptyEl.textContent = 'Belum ada HP yang terhubung saat ini.';
      remoteClientsList.appendChild(emptyEl);
    } else {
      safeActive.forEach(client => {
        const row = document.createElement('div');
        row.className = 'remote-client-item';

        const infoCol = document.createElement('div');
        infoCol.className = 'remote-client-info';

        const nameRow = document.createElement('div');
        nameRow.className = 'remote-client-name';

        const dot = document.createElement('span');
        dot.className = 'remote-client-dot';
        nameRow.appendChild(dot);

        const labelSpan = document.createElement('span');
        labelSpan.textContent = client.label || 'Perangkat HP';
        nameRow.appendChild(labelSpan);

        const metaRow = document.createElement('div');
        metaRow.className = 'remote-client-meta';
        const shortId = String(client.tag || client.client_id || '').slice(-4);
        const cmdCount = Number(client.commands_sent || client.cmd_count) || 0;
        metaRow.textContent = `IP: ${client.ip || '-'} • ID #${shortId} • ${cmdCount} aksi`;

        infoCol.appendChild(nameRow);
        infoCol.appendChild(metaRow);

        const actionsCol = document.createElement('div');
        actionsCol.className = 'remote-client-actions';

        const isViewOnly = client.role === 'view_only';
        const roleBtn = document.createElement('button');
        roleBtn.type = 'button';
        roleBtn.className = 'btn-client-role' + (isViewOnly ? ' view-only' : '');
        roleBtn.textContent = isViewOnly ? '👁️ Pantau Saja' : '🎛️ Kontrol Penuh';
        roleBtn.title = isViewOnly
          ? 'HP ini hanya bisa melihat layar tanpa mengubah fader/lagu. Klik untuk beri Kontrol Penuh.'
          : 'HP ini bisa mengontrol Fader & Lagu. Klik untuk ubah ke Mode Pantau Saja (View-Only).';
        roleBtn.addEventListener('click', async () => {
          const nextRole = isViewOnly ? 'control' : 'view_only';
          const { ok, data } = await apiPost('/api/remote/clients', {
            action: 'set_role',
            client_id: client.client_id,
            role: nextRole,
          });
          if (ok && data) {
            renderConnectedRemoteClients(data.active_remotes, data.blocked_remotes, true);
            notify({
              type: 'info',
              title: nextRole === 'view_only' ? 'Mode Pantau (View-Only) Aktif' : 'Mode Kontrol Penuh Aktif',
              message: `${client.label || 'HP'} (${client.ip}) kini dalam mode ${
                nextRole === 'view_only' ? 'Pantau Saja' : 'Kontrol Penuh'
              }.`,
              duration: 2800,
            });
          }
        });

        const kickBtn = document.createElement('button');
        kickBtn.type = 'button';
        kickBtn.className = 'btn-client-kick';
        kickBtn.textContent = '✕ Putus';
        kickBtn.title = 'Putus koneksi & blokir HP ini dari Master Deck';
        kickBtn.addEventListener('click', async () => {
          const { ok, data } = await apiPost('/api/remote/clients', {
            action: 'kick',
            client_id: client.client_id,
          });
          if (ok && data) {
            renderConnectedRemoteClients(data.active_remotes, data.blocked_remotes, true);
            const cnt = Number(data.active_remotes_count) || 0;
            if (remoteModalClientCount) {
              remoteModalClientCount.textContent =
                cnt > 0 ? `● ${cnt} HP Terhubung Aktif` : '0 HP Terhubung (Siap Menerima Koneksi)';
            }
            if (btnOpenRemoteModal && remoteHeaderLabel) {
              btnOpenRemoteModal.classList.toggle('connected', cnt > 0);
              remoteHeaderLabel.textContent = cnt > 0 ? `HP Remote (${cnt})` : 'HP Remote';
            }
            notify({
              type: 'info',
              title: 'Koneksi HP Diputus',
              message: `${client.label || 'HP'} (${client.ip}) telah diputus dari Master Deck.`,
              duration: 3000,
            });
          }
        });

        actionsCol.appendChild(roleBtn);
        actionsCol.appendChild(kickBtn);
        row.appendChild(infoCol);
        row.appendChild(actionsCol);
        remoteClientsList.appendChild(row);
      });
    }

    if (remoteBlockedSection && remoteBlockedList) {
      remoteBlockedSection.classList.toggle('hidden', safeBlocked.length === 0);
      remoteBlockedList.replaceChildren();
      safeBlocked.forEach(blocked => {
        const row = document.createElement('div');
        row.className = 'remote-client-item blocked';

        const infoCol = document.createElement('div');
        infoCol.className = 'remote-client-info';

        const nameRow = document.createElement('div');
        nameRow.className = 'remote-client-name';
        nameRow.textContent = `⛔ ${blocked.label || 'Perangkat HP'}`;

        const metaRow = document.createElement('div');
        metaRow.className = 'remote-client-meta';
        const shortId = String(blocked.client_id || '').slice(-4);
        metaRow.textContent = `IP: ${blocked.ip || '-'} • ID #${shortId} (Diblokir)`;

        infoCol.appendChild(nameRow);
        infoCol.appendChild(metaRow);

        const unblockBtn = document.createElement('button');
        unblockBtn.type = 'button';
        unblockBtn.className = 'btn-client-unblock';
        unblockBtn.textContent = '✓ Izinkan Lagi';
        unblockBtn.addEventListener('click', async () => {
          const { ok, data } = await apiPost('/api/remote/clients', {
            action: 'unblock',
            client_id: blocked.client_id,
          });
          if (ok && data) {
            renderConnectedRemoteClients(data.active_remotes, data.blocked_remotes, true);
            notify({
              type: 'success',
              title: 'Perangkat Diizinkan Kembali',
              message: `${blocked.label || 'HP'} (${blocked.ip}) dapat terhubung kembali.`,
              duration: 2800,
            });
          }
        });

        row.appendChild(infoCol);
        row.appendChild(unblockBtn);
        remoteBlockedList.appendChild(row);
      });
    }
  }

  if (btnKickAllRemotes) {
    btnKickAllRemotes.addEventListener('click', async () => {
      const { ok, data } = await apiPost('/api/remote/clients', { action: 'kick_all' });
      if (ok && data) {
        renderConnectedRemoteClients(data.active_remotes, data.blocked_remotes, true);
        if (remoteModalClientCount) {
          remoteModalClientCount.textContent = '0 HP Terhubung (Siap Menerima Koneksi)';
        }
        if (btnOpenRemoteModal && remoteHeaderLabel) {
          btnOpenRemoteModal.classList.remove('connected');
          remoteHeaderLabel.textContent = 'HP Remote';
        }
        notify({
          type: 'info',
          title: 'Semua HP Diputus',
          message: 'Seluruh perangkat HP yang terhubung telah diputus.',
          duration: 3000,
        });
      }
    });
  }

  async function refreshRemoteModalInfo(forceIpRefresh = false) {
    try {
      const res = await fetch('/api/remote/info' + (forceIpRefresh ? '?refresh=1' : ''), {
        headers: {
          'X-FOH-Client-ID': remoteClientId,
        },
      });
      if (!res.ok) return;
      const info = await res.json();
      if (info.port) currentRemoteServerPort = Number(info.port) || 8765;
      if (chkRemoteEnabled && typeof info.enabled === 'boolean') {
        chkRemoteEnabled.checked = info.enabled;
      }
      if (remotePinDisplay && info.pin) {
        remotePinDisplay.textContent = info.pin;
        if (!isRemoteController) {
          remotePin = info.pin;
        }
      }
      if (remoteModalClientCount) {
        const cnt = Number(info.active_remotes_count) || 0;
        remoteModalClientCount.textContent =
          cnt > 0 ? `● ${cnt} HP Terhubung Aktif` : '0 HP Terhubung (Siap Menerima Koneksi)';
      }
      renderConnectedRemoteClients(info.active_remotes, info.blocked_remotes, true);
      renderWslBridgeStatusUI(info.wsl_bridge);
      renderRemoteUrlItems(info.interfaces, info.remote_urls, info.pin);
    } catch (_e) {
      // Ignore network errors
    }
  }

  function openRemoteModal(forcePinEntry = false) {
    if (!remoteModal) return;
    const showPinEntry = isRemoteController || forcePinEntry;
    if (remoteMasterSetupPanel) {
      remoteMasterSetupPanel.classList.toggle('hidden', showPinEntry);
    }
    if (remoteClientPinPanel) {
      remoteClientPinPanel.classList.toggle('hidden', !showPinEntry);
    }
    if (btnOpenRemoteSimTab) {
      btnOpenRemoteSimTab.classList.toggle('hidden', showPinEntry);
    }
    remoteModal.classList.remove('hidden');

    if (showPinEntry) {
      if (remotePinInput) {
        remotePinInput.value = remotePin || '';
        setTimeout(() => remotePinInput.focus(), 50);
      }
    } else {
      refreshRemoteModalInfo(false);
    }
  }

  function closeRemoteModal() {
    if (remoteModal) {
      remoteModal.classList.add('hidden');
    }
  }

  if (btnOpenRemoteModal) {
    btnOpenRemoteModal.addEventListener('click', () => openRemoteModal(false));
  }
  if (btnRemotePinPrompt) {
    btnRemotePinPrompt.addEventListener('click', () => openRemoteModal(true));
  }
  if (btnCloseRemoteModal) {
    btnCloseRemoteModal.addEventListener('click', closeRemoteModal);
  }
  if (btnCancelRemoteModal) {
    btnCancelRemoteModal.addEventListener('click', closeRemoteModal);
  }
  if (remoteModal) {
    remoteModal.addEventListener('click', e => {
      if (e.target === remoteModal) closeRemoteModal();
    });
  }
  if (btnRefreshRemoteIps) {
    btnRefreshRemoteIps.addEventListener('click', () => refreshRemoteModalInfo(true));
  }
  if (btnEnableWslBridge) {
    btnEnableWslBridge.addEventListener('click', async () => {
      btnEnableWslBridge.disabled = true;
      if (btnEnableWslBridgeText) {
        btnEnableWslBridgeText.textContent = 'Menunggu Izin Admin Windows...';
      }
      const { ok, data, error } = await apiPost('/api/remote/wsl-bridge', {});
      btnEnableWslBridge.disabled = false;
      if (data && data.wsl_bridge) {
        renderWslBridgeStatusUI(data.wsl_bridge);
      } else {
        refreshRemoteModalInfo(true);
      }
      notify({
        type: ok ? 'success' : 'info',
        title: ok ? 'Jembatan Port WSL2 Aktif!' : 'Perlu Izin Administrator Windows',
        message:
          (data && data.message) ||
          error ||
          'Silakan klik Yes pada pop-up PowerShell atau jalankan perintah PowerShell secara manual.',
        duration: 4200,
      });
    });
  }
  if (btnDisableWslBridge) {
    btnDisableWslBridge.addEventListener('click', async () => {
      btnDisableWslBridge.disabled = true;
      btnDisableWslBridge.textContent = 'Menutup Port...';
      const { ok, data } = await apiPost('/api/remote/wsl-bridge', { action: 'disable' });
      btnDisableWslBridge.disabled = false;
      btnDisableWslBridge.textContent = 'Tutup Port';
      if (data && data.wsl_bridge) {
        renderWslBridgeStatusUI(data.wsl_bridge);
      } else {
        refreshRemoteModalInfo(true);
      }
      notify({
        type: ok ? 'info' : 'error',
        title: ok ? 'Jembatan Port Ditutup' : 'Gagal Menutup Jembatan',
        message: (data && data.message) || 'Aturan portproxy dan firewall Windows telah dihapus.',
        duration: 3800,
      });
    });
  }
  if (btnCopyWslCmd) {
    btnCopyWslCmd.addEventListener('click', async () => {
      if (!latestWslPowerShellCmd) return;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(latestWslPowerShellCmd);
          btnCopyWslCmd.textContent = 'Cmd Tersalin ✓';
          setTimeout(() => {
            btnCopyWslCmd.textContent = 'Salin Cmd PowerShell';
          }, 2000);
          notify({
            type: 'info',
            title: 'Perintah PowerShell Disalin',
            message: 'Buka PowerShell (Run as Administrator) di Windows, lalu Paste & tekan Enter.',
            duration: 4000,
          });
        }
      } catch (_e) {
        // Ignore clipboard errors
      }
    });
  }
  function applyManualIpToQr() {
    if (!remoteManualIpInput) return;
    const rawIp = remoteManualIpInput.value.trim().replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
    if (!rawIp) return;
    const customUrl = `http://${rawIp}:${currentRemoteServerPort}/player?remote=1&pin=${encodeURIComponent(remotePin || '')}`;
    renderQrForRemoteUrl(customUrl, 'IP Manual');
    notify({
      type: 'success',
      title: 'QR Code Diperbarui',
      message: `QR Code kini mengarah ke ${customUrl}`,
      duration: 2800,
    });
  }
  if (btnApplyManualIp) {
    btnApplyManualIp.addEventListener('click', applyManualIpToQr);
  }
  if (remoteManualIpInput) {
    remoteManualIpInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyManualIpToQr();
      }
    });
  }
  if (btnRegenRemotePin) {
    btnRegenRemotePin.addEventListener('click', async () => {
      const { ok, data } = await apiPost('/api/remote/state', { regenerate_pin: true });
      if (ok && data && data.pin) {
        if (remotePinDisplay) remotePinDisplay.textContent = data.pin;
        refreshRemoteModalInfo(false);
        notify({
          type: 'info',
          title: 'PIN FOH Remote Diperbarui',
          message: `PIN baru: ${data.pin}. Masukkan PIN ini di HP Anda.`,
          duration: 3000,
        });
      }
    });
  }
  if (chkRemoteEnabled) {
    chkRemoteEnabled.addEventListener('change', async () => {
      await apiPost('/api/remote/state', { enabled: Boolean(chkRemoteEnabled.checked) });
      refreshRemoteModalInfo(false);
    });
  }
  if (btnOpenRemoteSimTab) {
    btnOpenRemoteSimTab.addEventListener('click', () => {
      const pinParam = remotePin ? `&pin=${encodeURIComponent(remotePin)}` : '';
      window.open(`/player?remote=1${pinParam}`, '_blank');
    });
  }
  if (btnExitRemoteSim) {
    btnExitRemoteSim.addEventListener('click', () => {
      window.location.href = '/player';
    });
  }

  function submitClientPin() {
    if (!remotePinInput) return;
    const entered = remotePinInput.value.trim();
    if (entered.length !== 4) {
      if (remotePinFeedback) {
        remotePinFeedback.textContent = 'PIN harus terdiri dari 4 angka.';
      }
      return;
    }
    remotePin = entered;
    try {
      localStorage.setItem(REMOTE_PIN_STORAGE_KEY, entered);
    } catch (_e) {
      // Ignore storage error
    }
    syncRemotePinButtonText();
    closeRemoteModal();
    pollRemoteStateFromMaster();
  }

  if (btnSaveRemotePin) {
    btnSaveRemotePin.addEventListener('click', submitClientPin);
  }
  if (remotePinInput) {
    remotePinInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitClientPin();
      }
    });
  }

  let lastRemoteBlockToastAt = 0;
  async function sendRemoteCommand(action, params = {}) {
    if (!isRemoteController) return;
    try {
      const res = await fetch('/api/remote/command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-FOH-PIN': remotePin,
          'X-FOH-Client-ID': remoteClientId,
        },
        body: JSON.stringify({
          action,
          params,
          pin: remotePin,
        }),
      });
      if (res.status === 401) {
        openRemoteModal(true);
        notify({
          type: 'error',
          title: 'PIN FOH Remote Diperlukan',
          message: 'Masukkan 4-Digit PIN yang tertera di tombol HP Remote pada Laptop.',
        });
      } else if (res.status === 403) {
        const now = Date.now();
        if (now - lastRemoteBlockToastAt > 2500) {
          lastRemoteBlockToastAt = now;
          const errData = await res.json().catch(() => ({}));
          if (errData.code === 'VIEW_ONLY') {
            notify({
              type: 'info',
              title: 'Mode Pantau Saja (View-Only)',
              message: 'HP ini diatur ke Mode Pantau oleh operator Master Deck (tidak bisa mengubah kontrol).',
              duration: 2600,
            });
          } else if (errData.code === 'KICKED') {
            notify({
              type: 'error',
              title: 'Koneksi HP Diputus',
              message: 'Akses HP ini telah diputus oleh operator Master Deck.',
              duration: 3200,
            });
          }
        }
      }
    } catch (_e) {
      // Ignore transient network errors
    }
  }

  const throttledRemoteTimers = new Map();
  function sendThrottledRemoteCommand(action, params = {}, delayMs = 60) {
    if (!isRemoteController) return;
    const existing = throttledRemoteTimers.get(action);
    if (existing) {
      existing.params = { ...existing.params, ...params };
      return;
    }
    const item = { params };
    item.timerId = setTimeout(() => {
      throttledRemoteTimers.delete(action);
      sendRemoteCommand(action, item.params);
    }, delayMs);
    throttledRemoteTimers.set(action, item);
  }

  function flushThrottledRemoteCommand(action, fallbackParams = null) {
    if (!isRemoteController) return;
    const existing = throttledRemoteTimers.get(action);
    if (existing) {
      clearTimeout(existing.timerId);
      throttledRemoteTimers.delete(action);
      sendRemoteCommand(action, fallbackParams !== null ? fallbackParams : existing.params);
    } else if (fallbackParams !== null) {
      sendRemoteCommand(action, fallbackParams);
    }
  }

  function buildMasterStateSnapshot() {
    const curSec = audioEl && Number.isFinite(audioEl.currentTime) ? Number(audioEl.currentTime.toFixed(2)) : 0;
    const durSec = audioEl && Number.isFinite(audioEl.duration) ? Number(audioEl.duration.toFixed(2)) : 0;
    const isPlayingNow = Boolean(audioEl && !audioEl.paused && !audioEl.ended);
    let transportState = 'STANDBY';
    if (isFadingOut) transportState = 'FADING';
    else if (isPlayingNow) transportState = 'PLAYING';
    else if (activeTrackObj && curSec > 0.05) transportState = 'PAUSED';
    else if (activeTrackObj) transportState = 'CUED';

    return {
      track: activeTrackObj
        ? {
            rel_path: activeTrackObj.rel_path,
            name: activeTrackObj.name,
            folder: activeTrackObj.folder || '',
            ext: activeTrackObj.ext || '',
            size_mb: activeTrackObj.size_mb || 0,
            qc: activeTrackObj.qc || {},
          }
        : null,
      is_playing: isPlayingNow,
      transport_state: transportState,
      current_time: curSec,
      duration: durSec,
      play_mode: playMode,
      volume: volumeSlider ? Number(volumeSlider.value) : 100,
      is_muted: Boolean(isMuted),
      preamp_db: preampSlider ? Number(preampSlider.value) : 0,
      eq_low_db: eqLowSlider ? Number(eqLowSlider.value) : 0,
      eq_mid_db: eqMidSlider ? Number(eqMidSlider.value) : 0,
      eq_high_db: eqHighSlider ? Number(eqHighSlider.value) : 0,
      routing_mode: routingMode,
      auto_trim: Boolean(chkAutoTrim && chkAutoTrim.checked),
      peak_db: Number.isFinite(maxPeakHoldDb) ? Number(maxPeakHoldDb.toFixed(1)) : -100,
      rta_bands: isPlayingNow ? latestRtaBands : [],
      vu_l: isPlayingNow ? Number(latestVuL.toFixed(3)) : 0,
      vu_r: isPlayingNow ? Number(latestVuR.toFixed(3)) : 0,
      cue_pads: cuePads,
      source_dir: currentSourceDir || '',
      active_playlist: activePlaylist || 'ALL',
    };
  }

  function executeRemoteCommandOnMaster(cmd) {
    if (!cmd || !cmd.action) return;
    const p = cmd.params || {};
    switch (cmd.action) {
      case 'play_pause':
        if (audioEl && !audioEl.paused) pauseCurrentTrack();
        else playCurrentTrack();
        break;
      case 'play':
        playCurrentTrack();
        break;
      case 'pause':
        pauseCurrentTrack();
        break;
      case 'stop':
        stopAndResetCue();
        break;
      case 'prev': {
        const prev = getAdjacentTrack(-1);
        if (prev) loadTrack(prev, Boolean(audioEl && !audioEl.paused));
        break;
      }
      case 'next': {
        const next = getAdjacentTrack(1);
        if (next) loadTrack(next, Boolean(audioEl && !audioEl.paused));
        break;
      }
      case 'fade':
        triggerSmoothFadeOut(Number(p.duration) || 3.0);
        break;
      case 'seek_ratio':
        if (audioEl && Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
          const r = Math.max(0, Math.min(1, Number(p.ratio) || 0));
          audioEl.currentTime = r * audioEl.duration;
          updateTimecodeUI();
        }
        break;
      case 'nudge':
        nudgeSeek(Number(p.delta) || 0);
        break;
      case 'cue_zero':
        if (audioEl) {
          audioEl.currentTime = 0;
          updateTimecodeUI();
        }
        break;
      case 'set_play_mode':
        if (['cue', 'continuous', 'loop'].includes(p.mode)) {
          setPlayMode(p.mode);
        }
        break;
      case 'set_volume':
        if (volumeSlider) {
          volumeSlider.value = String(Math.max(0, Math.min(100, Number(p.volume) || 0)));
          isMuted = false;
          if (btnMute) {
            btnMute.textContent = 'Mute';
            btnMute.classList.remove('active');
          }
          applyGainAndEqNodes();
          savePlayerPrefs();
        }
        break;
      case 'toggle_mute':
        isMuted = typeof p.is_muted === 'boolean' ? p.is_muted : !isMuted;
        if (btnMute) {
          btnMute.textContent = isMuted ? 'Unmute' : 'Mute';
          btnMute.classList.toggle('active', isMuted);
        }
        applyGainAndEqNodes();
        break;
      case 'set_preamp':
        if (preampSlider) {
          ensureAudioGraph();
          preampSlider.value = String(Math.max(-12, Math.min(6, Number(p.preamp_db) || 0)));
          applyGainAndEqNodes();
        }
        break;
      case 'set_eq':
        ensureAudioGraph();
        if (eqLowSlider && p.low_db !== undefined) eqLowSlider.value = String(p.low_db);
        if (eqMidSlider && p.mid_db !== undefined) eqMidSlider.value = String(p.mid_db);
        if (eqHighSlider && p.high_db !== undefined) eqHighSlider.value = String(p.high_db);
        applyGainAndEqNodes();
        break;
      case 'reset_eq':
        if (eqLowSlider) eqLowSlider.value = '0';
        if (eqMidSlider) eqMidSlider.value = '0';
        if (eqHighSlider) eqHighSlider.value = '0';
        applyGainAndEqNodes();
        break;
      case 'set_routing':
        if (['stereo', 'mono', 'left', 'right', 'invert'].includes(p.mode)) {
          ensureAudioGraph();
          routingMode = p.mode;
          routingButtons.forEach(b => b.classList.toggle('active', b.dataset.route === routingMode));
          applyRoutingMatrix();
        }
        break;
      case 'set_autotrim':
        if (chkAutoTrim) {
          chkAutoTrim.checked = Boolean(p.enabled);
          if (chkAutoTrim.checked && activeTrackObj && preampSlider) {
            preampSlider.value = String(computeRecommendedAutoTrimDb(activeTrackObj));
          } else if (!chkAutoTrim.checked && preampSlider) {
            preampSlider.value = '0';
          }
          applyGainAndEqNodes();
          if (activeTrackObj) updateNowPlayingCard(activeTrackObj);
          savePlayerPrefs();
        }
        break;
      case 'reset_peak':
        maxPeakHoldDb = -Infinity;
        updatePeakBadge();
        break;
      case 'trigger_pad':
        if (typeof p.index === 'number' && p.index >= 0 && p.index < 8) {
          triggerCuePad(p.index);
        }
        break;
      case 'restart_pad':
        if (typeof p.index === 'number' && p.index >= 0 && p.index < 8) {
          restartCuePadFromZero(p.index);
        }
        break;
      case 'clear_pad':
        if (p.all) {
          cuePads = Array(8).fill(null);
        } else if (typeof p.index === 'number' && p.index >= 0 && p.index < 8) {
          cuePads[p.index] = null;
        }
        saveCuePads();
        renderCuePads();
        break;
      case 'assign_pad': {
        const targetFile = p.rel_path ? allFiles.find(f => f.rel_path === p.rel_path) : activeTrackObj;
        if (targetFile) {
          assignFileToCuePad(targetFile, typeof p.index === 'number' ? p.index : null);
        }
        break;
      }
      case 'load_track': {
        const targetFile = p.rel_path ? allFiles.find(f => f.rel_path === p.rel_path) : null;
        if (targetFile) {
          loadTrack(targetFile, Boolean(p.auto_play));
        }
        break;
      }
      case 'select_playlist':
        if (typeof p.playlist === 'string') {
          activePlaylist = p.playlist;
          if (playlistSelectDropdown) playlistSelectDropdown.value = activePlaylist;
          renderPlaylists();
          applyFiltersAndRenderTable();
          persistWorkspaceState();
        }
        break;
      default:
        break;
    }
  }

  let isMasterSyncInFlight = false;
  async function pushMasterStateAndPollCommands() {
    if (isRemoteController || isMasterSyncInFlight || isPageUnloading) return;
    isMasterSyncInFlight = true;
    try {
      const res = await fetch('/api/remote/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: buildMasterStateSnapshot() }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.pin) remotePin = data.pin;
        const cnt = Number(data.active_remotes_count) || 0;
        if (btnOpenRemoteModal && remoteHeaderLabel) {
          btnOpenRemoteModal.classList.toggle('connected', cnt > 0);
          remoteHeaderLabel.textContent = cnt > 0 ? `HP Remote (${cnt})` : 'HP Remote';
        }
        if (remoteModalClientCount) {
          remoteModalClientCount.textContent =
            cnt > 0 ? `● ${cnt} HP Terhubung Aktif` : '0 HP Terhubung (Siap Menerima Koneksi)';
        }
        if (remoteModal && !remoteModal.classList.contains('hidden')) {
          renderConnectedRemoteClients(data.active_remotes, data.blocked_remotes, false);
        }
        if (Array.isArray(data.commands) && data.commands.length > 0) {
          data.commands.forEach(cmd => executeRemoteCommandOnMaster(cmd));
        }
      }
    } catch (_e) {
      // Ignore transient errors
    } finally {
      isMasterSyncInFlight = false;
    }
  }

  function applyMasterStateToRemoteUI(st) {
    if (!st) return;

    // 1. Sync Source Directory if changed on Master Deck
    if (typeof st.source_dir === 'string' && st.source_dir !== currentSourceDir) {
      currentSourceDir = st.source_dir;
      fetchLibrary(currentSourceDir);
    }

    // 2. Sync Active Playlist if changed
    if (typeof st.active_playlist === 'string' && st.active_playlist !== activePlaylist) {
      activePlaylist = st.active_playlist;
      if (playlistSelectDropdown) playlistSelectDropdown.value = activePlaylist;
      renderPlaylists();
      applyFiltersAndRenderTable();
    }

    // 3. Sync Playing State & Timecode
    const prevPlaying = remoteIsPlaying;
    remoteIsPlaying = Boolean(st.is_playing);
    remoteCurrentTime = Number(st.current_time) || 0;
    remoteDuration = Number(st.duration) || 0;

    if (remoteIsPlaying && requestRtaWake) {
      requestRtaWake();
    }

    setTransportStateBadge(st.transport_state || 'STANDBY');
    syncPlayPauseButton(remoteIsPlaying);
    updateTimecodeUI();

    // 4. Sync Active Track OLED Card & Row Highlight
    const prevRel = activeTrackObj ? activeTrackObj.rel_path : '';
    const newRel = st.track && st.track.rel_path ? st.track.rel_path : '';
    if (st.track && newRel) {
      const matched = allFiles.find(f => f.rel_path === newRel) || st.track;
      activeTrackObj = matched;
      activeTrackRelPath = newRel;
      if (newRel !== prevRel) {
        updateNowPlayingCard(matched);
      }
    }
    if (newRel !== prevRel || prevPlaying !== remoteIsPlaying) {
      highlightActiveRowInTable();
    }

    // 5. Sync Play Mode
    if (st.play_mode && st.play_mode !== playMode) {
      setPlayMode(st.play_mode, { fromRemoteSync: true });
    }

    // 6. Sync Sliders / Mute / EQ / Routing (unless user touched a control within last 800ms)
    const userRecentlyTouched = Date.now() - lastLocalControlTouchAt < 800;
    if (!userRecentlyTouched) {
      if (volumeSlider && typeof st.volume === 'number') {
        volumeSlider.value = String(st.volume);
      }
      if (typeof st.is_muted === 'boolean') {
        isMuted = st.is_muted;
        if (btnMute) {
          btnMute.textContent = isMuted ? 'Unmute' : 'Mute';
          btnMute.classList.toggle('active', isMuted);
        }
      }
      if (preampSlider && typeof st.preamp_db === 'number') {
        preampSlider.value = String(st.preamp_db);
      }
      if (eqLowSlider && typeof st.eq_low_db === 'number') {
        eqLowSlider.value = String(st.eq_low_db);
      }
      if (eqMidSlider && typeof st.eq_mid_db === 'number') {
        eqMidSlider.value = String(st.eq_mid_db);
      }
      if (eqHighSlider && typeof st.eq_high_db === 'number') {
        eqHighSlider.value = String(st.eq_high_db);
      }
      if (chkAutoTrim && typeof st.auto_trim === 'boolean') {
        chkAutoTrim.checked = st.auto_trim;
      }
      if (st.routing_mode && st.routing_mode !== routingMode) {
        routingMode = st.routing_mode;
        routingButtons.forEach(b => b.classList.toggle('active', b.dataset.route === routingMode));
        syncRoutingBadgeUI();
      }
      applyGainAndEqNodes();
    }

    // 7. Sync Peak Hold & RTA / VU Telemetry
    if (typeof st.peak_db === 'number') {
      maxPeakHoldDb = st.peak_db <= -99 ? -Infinity : st.peak_db;
      updatePeakBadge();
    }
    if (Array.isArray(st.rta_bands) && st.rta_bands.length === 32) {
      remoteRtaBands = st.rta_bands;
    }
    remoteVuL = Number(st.vu_l) || 0;
    remoteVuR = Number(st.vu_r) || 0;

    // 8. Sync 8 Instant Cue Pads
    if (Array.isArray(st.cue_pads) && st.cue_pads.length === 8) {
      const oldJson = JSON.stringify(cuePads);
      const newJson = JSON.stringify(st.cue_pads);
      if (oldJson !== newJson || newRel !== prevRel || prevPlaying !== remoteIsPlaying) {
        cuePads = st.cue_pads;
        renderCuePads();
      }
    }
  }

  let isRemotePollInFlight = false;
  async function pollRemoteStateFromMaster() {
    if (!isRemoteController || isRemotePollInFlight || isPageUnloading) return;
    isRemotePollInFlight = true;
    try {
      const res = await fetch('/api/remote/state', {
        headers: {
          'X-FOH-PIN': remotePin,
          'X-FOH-Client-ID': remoteClientId,
        },
      });
      if (res.status === 401) {
        if (remoteConnStatus) {
          remoteConnStatus.textContent = '🔒 PIN Diperlukan — Klik tombol PIN untuk menghubungkan';
          remoteConnStatus.className = 'remote-conn-status err';
        }
        if (!hasPromptedPinModalOnce) {
          hasPromptedPinModalOnce = true;
          openRemoteModal(true);
        }
        return;
      }
      if (res.status === 403) {
        const errData = await res.json().catch(() => ({}));
        if (remoteConnStatus) {
          if (errData.code === 'KICKED') {
            remoteConnStatus.textContent = '⛔ Koneksi HP ini telah diputus oleh Master Deck';
          } else {
            remoteConnStatus.textContent = '⛔ HP Remote sedang dinonaktifkan di Laptop Master Deck';
          }
          remoteConnStatus.className = 'remote-conn-status err';
        }
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (remoteConnStatus) {
          if (data.master_online) {
            if (data.role === 'view_only') {
              remoteConnStatus.textContent = '👁️ Mode Pantau Saja (View-Only) — Terhubung ke Master Deck';
              remoteConnStatus.className = 'remote-conn-status warn';
            } else {
              remoteConnStatus.textContent = '● Connected to Master Deck (Audio Out: Laptop/Soundcard)';
              remoteConnStatus.className = 'remote-conn-status online';
            }
          } else {
            remoteConnStatus.textContent = '○ Menunggu halaman /player dibuka di Laptop Master Deck...';
            remoteConnStatus.className = 'remote-conn-status warn';
          }
        }
        if (data.state) {
          applyMasterStateToRemoteUI(data.state);
        }
      }
    } catch (_e) {
      if (remoteConnStatus) {
        remoteConnStatus.textContent = '○ Koneksi Wi-Fi terputus — Mencoba menghubungkan ulang...';
        remoteConnStatus.className = 'remote-conn-status err';
      }
    } finally {
      isRemotePollInFlight = false;
    }
  }

  function initRemoteModeEngine() {
    syncRemotePinButtonText();
    if (isRemoteController) {
      document.body.classList.add('remote-controller-mode');
      if (remoteModeBanner) remoteModeBanner.classList.remove('hidden');
      if (btnExitRemoteSim && isLocalhostHost) {
        btnExitRemoteSim.classList.remove('hidden');
      }
      if (btnOpenRemoteModal && remoteHeaderLabel) {
        btnOpenRemoteModal.classList.add('connected');
        remoteHeaderLabel.textContent = 'Remote Active';
      }
      // Hide local-OS-only controls when operating from a smartphone remote
      if (btnBrowseSource) btnBrowseSource.classList.add('hidden');
      if (btnOpenExplorer) btnOpenExplorer.classList.add('hidden');
      if (btnQuickAuditSetlist) btnQuickAuditSetlist.classList.add('hidden');
      pollRemoteStateFromMaster();
      setInterval(pollRemoteStateFromMaster, 350);
    } else {
      pushMasterStateAndPollCommands();
      setInterval(pushMasterStateAndPollCommands, 350);
    }
  }

  // Initialize Player State & Start RTA Loop
  loadPlayerPrefs();
  setPlayMode(playMode, { fromRemoteSync: true });
  syncRoutingBadgeUI();
  syncDspRackTabsUI();
  syncCuePadsCollapseUI();
  applyGainAndEqNodes();
  renderCuePads();
  if (!isRemoteController) {
    refreshAudioOutputDevices();
  }
  startRtaRenderLoop();
  fetchLibrary(currentSourceDir);
  initRemoteModeEngine();
});

