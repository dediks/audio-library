/**
 * SWARARIA AUDIO LAB - Studio-Grade Persistent Floating Player Bar & Mini-Pill Toggle
 * Strict DOM Manipulation (No innerHTML, strictly createElement, createElementNS, textContent)
 */

import { spaNavigate } from './spa-router.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DOCK_MINIMIZED_KEY = 'swararia_dock_minimized';

let isSeekingDock = false;
let lastNonZeroVolume = 100;
let isDockMinimized = false;

try {
  isDockMinimized = sessionStorage.getItem(DOCK_MINIMIZED_KEY) === '1';
} catch (_) {}

function formatDockTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const mins = Math.floor(sec / 60);
  const remSec = Math.floor(sec % 60);
  const mm = String(mins).padStart(2, '0');
  const ss = String(remSec).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function cleanTrackTitle(raw) {
  if (!raw) return 'Tidak Ada Lagu Aktif';
  return String(raw)
    .replace(/\s*\[[a-zA-Z0-9_-]{11}\]/g, '') // Strip YouTube video IDs
    .replace(/\.(webm|mp3|opus|m4a|wav|flac|aac|ogg)$/i, '') // Strip file extensions
    .trim() || raw;
}

function createFilledSvg(viewBox, children) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'currentColor');
  children.forEach(({ tag, attrs }) => {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    svg.appendChild(el);
  });
  return svg;
}

export function ensureFohAudioElement() {
  let audioEl = document.getElementById('fohAudioElement');
  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.id = 'fohAudioElement';
    audioEl.preload = 'metadata';
    audioEl.crossOrigin = 'anonymous';
    document.body.appendChild(audioEl);
  } else if (audioEl.parentElement && audioEl.parentElement.tagName === 'MAIN') {
    // Reparent outside of <main> so view swapping never detaches it
    document.body.appendChild(audioEl);
  }
  return audioEl;
}

function isPlayerRoute() {
  const p = window.location.pathname.replace(/\/+$/, '') || '/';
  return p === '/player' || p === '/player.html' || document.body.dataset.page === 'player';
}

export function setDockMinimized(minimized) {
  isDockMinimized = Boolean(minimized);
  try {
    sessionStorage.setItem(DOCK_MINIMIZED_KEY, isDockMinimized ? '1' : '0');
  } catch (_) {}

  if (document.body) {
    document.body.classList.toggle('dock-is-minimized', isDockMinimized);
  }

  const dock = document.getElementById('persistentPlayerDock');
  if (dock) {
    dock.classList.toggle('is-minimized', isDockMinimized);
  }

  syncDockVisibility();
}

export function toggleDockMinimized() {
  setDockMinimized(!isDockMinimized);
}

export function syncDockVisibility() {
  const dock = document.getElementById('persistentPlayerDock');
  const miniPill = document.getElementById('dockMiniPill');
  if (!dock) return;

  if (isPlayerRoute()) {
    dock.classList.add('is-hidden');
    dock.style.display = 'none';
    if (miniPill) miniPill.classList.remove('is-active');
    return;
  }

  const audioEl = document.getElementById('fohAudioElement');
  const hasTrack = Boolean(window.__swarariaFohDeck?.getTrack()) || Boolean(audioEl && audioEl.src);

  if (hasTrack) {
    if (isDockMinimized) {
      dock.classList.add('is-minimized');
      dock.style.display = 'grid'; // remains in layout but translated down
      if (miniPill) miniPill.classList.add('is-active');
    } else {
      dock.classList.remove('is-minimized');
      dock.classList.remove('is-hidden');
      dock.style.display = 'grid';
      if (miniPill) miniPill.classList.remove('is-active');
    }
  } else {
    dock.classList.add('is-hidden');
    dock.style.display = 'none';
    if (miniPill) miniPill.classList.remove('is-active');
  }
}

export function initPersistentDock() {
  const existing = document.getElementById('persistentPlayerDock');
  if (existing) {
    syncDockVisibility();
    return existing;
  }

  const audioEl = ensureFohAudioElement();

  // 1. Root Grid Container
  const dock = document.createElement('div');
  dock.id = 'persistentPlayerDock';
  dock.className = 'floating-player-dock' + (isDockMinimized ? ' is-minimized' : '');
  dock.setAttribute('role', 'region');
  dock.setAttribute('aria-label', 'Floating Audio Player');

  if (document.body && isDockMinimized) {
    document.body.classList.add('dock-is-minimized');
  }

  // Initial visibility check
  if (isPlayerRoute()) {
    dock.classList.add('is-hidden');
    dock.style.display = 'none';
  }

  // ---------------------------------------------------------------------------
  // 2. Left Column: Vinyl Art, Clean Title & Subtitle Badge
  // ---------------------------------------------------------------------------
  const trackInfo = document.createElement('div');
  trackInfo.className = 'dock-track-info';

  const coverArt = document.createElement('div');
  coverArt.id = 'dockCoverArt';
  coverArt.className = 'dock-cover-art';

  const vinylIcon = createFilledSvg('0 0 24 24', [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '10', fill: 'rgba(255,255,255,0.08)' } },
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '4', fill: 'currentColor' } },
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '1.5', fill: '#0a0b0f' } },
  ]);
  coverArt.appendChild(vinylIcon);

  const textWrap = document.createElement('div');
  textWrap.className = 'dock-text-wrap';

  const trackTitle = document.createElement('div');
  trackTitle.id = 'dockTrackTitle';
  trackTitle.className = 'dock-track-title';
  trackTitle.textContent = 'Tidak Ada Lagu Aktif';

  const trackMeta = document.createElement('div');
  trackMeta.id = 'dockTrackMeta';
  trackMeta.className = 'dock-track-meta';

  const metaFolderText = document.createElement('span');
  metaFolderText.id = 'dockMetaFolder';
  metaFolderText.className = 'dock-meta-folder';
  metaFolderText.textContent = 'FOH Deck Ready';

  const metaFormatBadge = document.createElement('span');
  metaFormatBadge.id = 'dockMetaBadge';
  metaFormatBadge.className = 'dock-badge-fmt';
  metaFormatBadge.textContent = 'AUDIO';

  trackMeta.appendChild(metaFolderText);
  trackMeta.appendChild(metaFormatBadge);

  textWrap.appendChild(trackTitle);
  textWrap.appendChild(trackMeta);
  trackInfo.appendChild(coverArt);
  trackInfo.appendChild(textWrap);

  // ---------------------------------------------------------------------------
  // 3. Center Column: Solid Transport Buttons & Centered Progress Scrubber
  // ---------------------------------------------------------------------------
  const transportCenter = document.createElement('div');
  transportCenter.className = 'dock-transport-center';

  const controlsRow = document.createElement('div');
  controlsRow.className = 'dock-controls-row';

  // Prev Button (Solid filled)
  const btnPrev = document.createElement('button');
  btnPrev.type = 'button';
  btnPrev.id = 'dockBtnPrev';
  btnPrev.className = 'dock-round-btn';
  btnPrev.title = 'Lagu Sebelumnya';
  btnPrev.appendChild(
    createFilledSvg('0 0 24 24', [
      { tag: 'polygon', attrs: { points: '18 19 8 12 18 5', fill: 'currentColor' } },
      { tag: 'rect', attrs: { x: '4', y: '5', width: '2.5', height: '14', rx: '1', fill: 'currentColor' } },
    ])
  );
  btnPrev.addEventListener('click', () => {
    if (window.__swarariaFohDeck && typeof window.__swarariaFohDeck.prev === 'function') {
      window.__swarariaFohDeck.prev();
    } else if (audioEl) {
      audioEl.currentTime = 0;
    }
  });

  // Play/Pause Button (Solid filled circle)
  const btnPlayPause = document.createElement('button');
  btnPlayPause.type = 'button';
  btnPlayPause.id = 'dockBtnPlayPause';
  btnPlayPause.className = 'dock-play-fab';
  btnPlayPause.title = 'Putar / Jeda (Spasi)';

  const iconPlay = createFilledSvg('0 0 24 24', [
    { tag: 'polygon', attrs: { points: '7 4 20 12 7 20', fill: 'currentColor' } },
  ]);
  iconPlay.setAttribute('width', '20');
  iconPlay.setAttribute('height', '20');

  const iconPause = createFilledSvg('0 0 24 24', [
    { tag: 'rect', attrs: { x: '5', y: '4', width: '4.5', height: '16', rx: '1.5', fill: 'currentColor' } },
    { tag: 'rect', attrs: { x: '14.5', y: '4', width: '4.5', height: '16', rx: '1.5', fill: 'currentColor' } },
  ]);
  iconPause.setAttribute('width', '20');
  iconPause.setAttribute('height', '20');

  btnPlayPause.appendChild(iconPlay);

  // Mini Pill icons
  const miniPlayIcon = createFilledSvg('0 0 24 24', [
    { tag: 'polygon', attrs: { points: '7 4 20 12 7 20', fill: 'currentColor' } },
  ]);
  miniPlayIcon.setAttribute('width', '13');
  miniPlayIcon.setAttribute('height', '13');

  const miniPauseIcon = createFilledSvg('0 0 24 24', [
    { tag: 'rect', attrs: { x: '5', y: '4', width: '4.5', height: '16', rx: '1.5', fill: 'currentColor' } },
    { tag: 'rect', attrs: { x: '14.5', y: '4', width: '4.5', height: '16', rx: '1.5', fill: 'currentColor' } },
  ]);
  miniPauseIcon.setAttribute('width', '13');
  miniPauseIcon.setAttribute('height', '13');

  function syncDockPlayButton(isPlaying) {
    btnPlayPause.replaceChildren(isPlaying ? iconPause : iconPlay);
    btnPlayPause.classList.toggle('is-playing', isPlaying);
    coverArt.classList.toggle('is-playing', isPlaying);

    const pillPlay = document.getElementById('dockMiniPillPlay');
    const pillArt = document.getElementById('dockMiniPillArt');
    if (pillPlay) pillPlay.replaceChildren(isPlaying ? miniPauseIcon : miniPlayIcon);
    if (pillArt) pillArt.classList.toggle('is-playing', isPlaying);
  }

  btnPlayPause.addEventListener('click', () => {
    if (window.__swarariaFohDeck && typeof window.__swarariaFohDeck.togglePlay === 'function') {
      window.__swarariaFohDeck.togglePlay();
    } else if (audioEl) {
      if (audioEl.paused) {
        audioEl.play().catch(() => {});
      } else {
        audioEl.pause();
      }
    }
  });

  // Stop Button (Solid filled rounded square)
  const btnStop = document.createElement('button');
  btnStop.type = 'button';
  btnStop.id = 'dockBtnStop';
  btnStop.className = 'dock-round-btn';
  btnStop.title = 'Stop & Reset Cue';
  btnStop.appendChild(
    createFilledSvg('0 0 24 24', [
      { tag: 'rect', attrs: { x: '6', y: '6', width: '12', height: '12', rx: '2.5', fill: 'currentColor' } },
    ])
  );
  btnStop.addEventListener('click', () => {
    if (window.__swarariaFohDeck && typeof window.__swarariaFohDeck.stop === 'function') {
      window.__swarariaFohDeck.stop();
    } else if (audioEl) {
      audioEl.pause();
      audioEl.currentTime = 0;
    }
  });

  // Next Button (Solid filled)
  const btnNext = document.createElement('button');
  btnNext.type = 'button';
  btnNext.id = 'dockBtnNext';
  btnNext.className = 'dock-round-btn';
  btnNext.title = 'Lagu Berikutnya';
  btnNext.appendChild(
    createFilledSvg('0 0 24 24', [
      { tag: 'polygon', attrs: { points: '6 5 16 12 6 19', fill: 'currentColor' } },
      { tag: 'rect', attrs: { x: '17.5', y: '5', width: '2.5', height: '14', rx: '1', fill: 'currentColor' } },
    ])
  );
  btnNext.addEventListener('click', () => {
    if (window.__swarariaFohDeck && typeof window.__swarariaFohDeck.next === 'function') {
      window.__swarariaFohDeck.next();
    }
  });

  controlsRow.appendChild(btnPrev);
  controlsRow.appendChild(btnPlayPause);
  controlsRow.appendChild(btnStop);
  controlsRow.appendChild(btnNext);

  // Scrubber Row with Real-Time Filled Track
  const scrubberRow = document.createElement('div');
  scrubberRow.className = 'dock-scrubber-row';

  const timeElapsed = document.createElement('span');
  timeElapsed.id = 'dockTimeElapsed';
  timeElapsed.className = 'dock-time';
  timeElapsed.textContent = '00:00';

  const seekSlider = document.createElement('input');
  seekSlider.type = 'range';
  seekSlider.id = 'dockSeekSlider';
  seekSlider.className = 'dock-seek-slider';
  seekSlider.min = '0';
  seekSlider.max = '100';
  seekSlider.value = '0';
  seekSlider.step = '0.1';
  seekSlider.title = 'Geser untuk memajukan / memundurkan durasi';

  function updateScrubberProgress(pct) {
    const clamped = Math.max(0, Math.min(100, pct));
    seekSlider.style.background = `linear-gradient(to right, #10b981 ${clamped}%, #232733 ${clamped}%)`;
  }

  seekSlider.addEventListener('input', () => {
    isSeekingDock = true;
    const val = Number(seekSlider.value);
    updateScrubberProgress(val);
    if (audioEl && Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
      const cur = (val / 100) * audioEl.duration;
      timeElapsed.textContent = formatDockTime(cur);
    }
  });

  seekSlider.addEventListener('change', () => {
    isSeekingDock = false;
    if (audioEl && Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
      const targetSec = (Number(seekSlider.value) / 100) * audioEl.duration;
      if (window.__swarariaFohDeck && typeof window.__swarariaFohDeck.seek === 'function') {
        window.__swarariaFohDeck.seek(targetSec);
      } else {
        audioEl.currentTime = targetSec;
      }
    }
  });

  const timeDuration = document.createElement('span');
  timeDuration.id = 'dockTimeDuration';
  timeDuration.className = 'dock-time';
  timeDuration.textContent = '00:00';

  scrubberRow.appendChild(timeElapsed);
  scrubberRow.appendChild(seekSlider);
  scrubberRow.appendChild(timeDuration);

  transportCenter.appendChild(controlsRow);
  transportCenter.appendChild(scrubberRow);

  // ---------------------------------------------------------------------------
  // 4. Right Column: Play Mode Pill, Smooth Volume, Expand Pill & Minimize Button
  // ---------------------------------------------------------------------------
  const actionsRight = document.createElement('div');
  actionsRight.className = 'dock-actions-right';

  const playModeBadge = document.createElement('button');
  playModeBadge.type = 'button';
  playModeBadge.id = 'dockPlayModeBadge';
  playModeBadge.className = 'dock-mode-pill';
  playModeBadge.textContent = 'CUE';
  playModeBadge.title = 'Mode Playback (Klik untuk mengganti: CUE / CONT / LOOP)';
  playModeBadge.addEventListener('click', () => {
    if (window.__swarariaFohDeck && typeof window.__swarariaFohDeck.getPlayMode === 'function') {
      const cur = window.__swarariaFohDeck.getPlayMode();
      const next = cur === 'cue' ? 'continuous' : cur === 'continuous' ? 'loop' : 'cue';
      window.__swarariaFohDeck.setPlayMode(next);
      playModeBadge.textContent = next.toUpperCase();
    }
  });

  const volWrap = document.createElement('div');
  volWrap.className = 'dock-vol-wrap';

  const btnMute = document.createElement('button');
  btnMute.type = 'button';
  btnMute.id = 'dockBtnMute';
  btnMute.className = 'dock-mute-btn';
  btnMute.title = 'Mute / Unmute';
  btnMute.textContent = '🔊';

  const volSlider = document.createElement('input');
  volSlider.type = 'range';
  volSlider.id = 'dockVolSlider';
  volSlider.className = 'dock-vol-slider';
  volSlider.min = '0';
  volSlider.max = '100';
  volSlider.value = '100';
  volSlider.title = 'Volume';

  function updateVolSliderProgress(val) {
    const clamped = Math.max(0, Math.min(100, val));
    volSlider.style.background = `linear-gradient(to right, #38bdf8 ${clamped}%, #232733 ${clamped}%)`;
  }
  updateVolSliderProgress(100);

  volSlider.addEventListener('input', () => {
    const val = Number(volSlider.value);
    updateVolSliderProgress(val);
    if (window.__swarariaFohDeck && typeof window.__swarariaFohDeck.setVolume === 'function') {
      window.__swarariaFohDeck.setVolume(val);
    } else if (audioEl) {
      audioEl.volume = val / 100;
    }
    btnMute.textContent = val === 0 ? '🔇' : val < 45 ? '🔉' : '🔊';
    if (val > 0) lastNonZeroVolume = val;
  });

  btnMute.addEventListener('click', () => {
    const curVal = Number(volSlider.value);
    if (curVal > 0) {
      lastNonZeroVolume = curVal;
      volSlider.value = '0';
    } else {
      volSlider.value = String(lastNonZeroVolume || 100);
    }
    volSlider.dispatchEvent(new Event('input'));
  });

  volWrap.appendChild(btnMute);
  volWrap.appendChild(volSlider);

  // Full Player Expand Pill Button
  const btnExpand = document.createElement('a');
  btnExpand.href = '/player';
  btnExpand.id = 'dockBtnExpand';
  btnExpand.className = 'dock-expand-pill';
  btnExpand.title = 'Buka Konsol Penuh FOH Live Player';

  const expandSpan = document.createElement('span');
  expandSpan.textContent = 'Konsol FOH';
  btnExpand.appendChild(expandSpan);

  const expandArrow = createFilledSvg('0 0 24 24', [
    { tag: 'path', attrs: { d: 'M5 19L19 5M19 5H9M19 5V15', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } },
  ]);
  expandArrow.setAttribute('width', '13');
  expandArrow.setAttribute('height', '13');
  btnExpand.appendChild(expandArrow);

  btnExpand.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    spaNavigate('/player');
  });

  // Minimize Chevron Down Button
  const btnMinimize = document.createElement('button');
  btnMinimize.type = 'button';
  btnMinimize.id = 'dockBtnMinimize';
  btnMinimize.className = 'dock-btn-minimize';
  btnMinimize.title = 'Sembunyikan / Minimize Player Bar';

  const chevronDownIcon = createFilledSvg('0 0 24 24', [
    { tag: 'polyline', attrs: { points: '6 9 12 15 18 9', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } },
  ]);
  chevronDownIcon.setAttribute('width', '16');
  chevronDownIcon.setAttribute('height', '16');
  btnMinimize.appendChild(chevronDownIcon);

  btnMinimize.addEventListener('click', () => {
    setDockMinimized(true);
  });

  actionsRight.appendChild(playModeBadge);
  actionsRight.appendChild(volWrap);
  actionsRight.appendChild(btnExpand);
  actionsRight.appendChild(btnMinimize);

  // Assemble Grid
  dock.appendChild(trackInfo);
  dock.appendChild(transportCenter);
  dock.appendChild(actionsRight);

  document.body.appendChild(dock);

  // ---------------------------------------------------------------------------
  // 5. Floating Mini Pill (Visible when dock is collapsed/minimized)
  // ---------------------------------------------------------------------------
  let miniPill = document.getElementById('dockMiniPill');
  if (!miniPill) {
    miniPill = document.createElement('div');
    miniPill.id = 'dockMiniPill';
    miniPill.className = 'dock-mini-pill';
    miniPill.title = 'Klik untuk menampilkan kembali FOH Player Bar';

    const pillArt = document.createElement('div');
    pillArt.id = 'dockMiniPillArt';
    pillArt.className = 'dock-mini-pill-art';
    pillArt.appendChild(
      createFilledSvg('0 0 24 24', [
        { tag: 'circle', attrs: { cx: '12', cy: '12', r: '10', fill: 'rgba(255,255,255,0.08)' } },
        { tag: 'circle', attrs: { cx: '12', cy: '12', r: '4', fill: 'currentColor' } },
        { tag: 'circle', attrs: { cx: '12', cy: '12', r: '1.5', fill: '#0a0b0f' } },
      ])
    );

    const pillTitle = document.createElement('span');
    pillTitle.id = 'dockMiniPillTitle';
    pillTitle.className = 'dock-mini-pill-title';
    pillTitle.textContent = 'Player Aktif';

    const pillPlayBtn = document.createElement('button');
    pillPlayBtn.type = 'button';
    pillPlayBtn.id = 'dockMiniPillPlay';
    pillPlayBtn.className = 'dock-mini-pill-play';
    pillPlayBtn.title = 'Putar / Jeda';
    pillPlayBtn.appendChild(miniPlayIcon.cloneNode(true));

    pillPlayBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Don't trigger expand
      if (window.__swarariaFohDeck && typeof window.__swarariaFohDeck.togglePlay === 'function') {
        window.__swarariaFohDeck.togglePlay();
      } else if (audioEl) {
        if (audioEl.paused) audioEl.play().catch(() => {});
        else audioEl.pause();
      }
    });

    const pillExpandIcon = document.createElement('span');
    pillExpandIcon.className = 'dock-mini-pill-expand';
    pillExpandIcon.textContent = '▲';
    pillExpandIcon.title = 'Tampilkan Player Bar';

    miniPill.appendChild(pillArt);
    miniPill.appendChild(pillTitle);
    miniPill.appendChild(pillPlayBtn);
    miniPill.appendChild(pillExpandIcon);

    miniPill.addEventListener('click', () => {
      setDockMinimized(false);
    });

    document.body.appendChild(miniPill);
  }

  // ---------------------------------------------------------------------------
  // 6. Audio Element Listeners for Live Scrubber & Timecode Sync
  // ---------------------------------------------------------------------------
  audioEl.addEventListener('timeupdate', () => {
    if (!isSeekingDock) {
      const cur = Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : 0;
      const dur = Number.isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;
      timeElapsed.textContent = formatDockTime(cur);
      if (dur > 0) {
        timeDuration.textContent = formatDockTime(dur);
        const pct = (cur / dur) * 100;
        seekSlider.value = String(pct.toFixed(2));
        updateScrubberProgress(pct);
      }
    }
  });

  audioEl.addEventListener('loadedmetadata', () => {
    const dur = Number.isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;
    timeDuration.textContent = formatDockTime(dur);
    syncDockVisibility();
  });

  audioEl.addEventListener('play', () => {
    syncDockPlayButton(true);
    syncDockVisibility();
  });
  audioEl.addEventListener('pause', () => syncDockPlayButton(false));
  audioEl.addEventListener('ended', () => syncDockPlayButton(false));

  audioEl.addEventListener('volumechange', () => {
    const pct = Math.round((audioEl.volume || 0) * 100);
    volSlider.value = String(pct);
    updateVolSliderProgress(pct);
    btnMute.textContent = audioEl.muted || pct === 0 ? '🔇' : pct < 45 ? '🔉' : '🔊';
  });

  // ---------------------------------------------------------------------------
  // 7. Hook Deck State Sync
  // ---------------------------------------------------------------------------
  function syncFromDeckState() {
    if (!window.__swarariaFohDeck) return;
    const track = window.__swarariaFohDeck.getTrack();
    if (track) {
      const cleanTitle = cleanTrackTitle(track.name || track.rel_path);
      trackTitle.textContent = cleanTitle;
      trackTitle.title = track.name || track.rel_path;
      metaFolderText.textContent = track.folder ? track.folder : 'Inbox Root';
      const fmt = (track.ext || '').toUpperCase().replace('.', '') || 'AUDIO';
      metaFormatBadge.textContent = fmt;

      const pillTitle = document.getElementById('dockMiniPillTitle');
      if (pillTitle) {
        pillTitle.textContent = cleanTitle;
        pillTitle.title = cleanTitle;
      }
    }
    const isPlaying = window.__swarariaFohDeck.isPlaying();
    syncDockPlayButton(isPlaying);
    const mode = window.__swarariaFohDeck.getPlayMode();
    if (mode) playModeBadge.textContent = mode.toUpperCase();

    syncDockVisibility();
  }

  if (window.__swarariaFohDeck && typeof window.__swarariaFohDeck.onStateChange === 'function') {
    window.__swarariaFohDeck.onStateChange(syncFromDeckState);
  }
  window.addEventListener('swararia:deck-state-change', syncFromDeckState);
  window.addEventListener('swararia:route-changed', syncDockVisibility);

  // Optional keyboard shortcut: Escape (when not focused on input) toggles minimize
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const tag = document.activeElement ? document.activeElement.tagName : '';
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
        if (!isPlayerRoute()) {
          toggleDockMinimized();
        }
      }
    }
  });

  // Initial check
  syncFromDeckState();
  syncDockVisibility();

  return dock;
}
