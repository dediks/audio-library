/**
 * SWARARIA AUDIO LAB - Client-Side Single Page Application (SPA) Router
 * Strict DOM Manipulation (No innerHTML, strictly createElement, createElementNS, textContent)
 */

import { initAppHeader } from './ui-shared.js';
import { ensureFohAudioElement, initPersistentDock } from './persistent-dock.js';

const ROUTE_CONFIG = {
  '/': { key: 'ingest', script: 'app.js', title: 'SWARARIA AUDIO LAB // 1. Batch Audio Ingestion', css: 'ingest.css' },
  '/index.html': { key: 'ingest', script: 'app.js', title: 'SWARARIA AUDIO LAB // 1. Batch Audio Ingestion', css: 'ingest.css' },
  '/qc': { key: 'qc', script: 'qc.js', title: 'SWARARIA AUDIO LAB // 2. Soundsystem QC & Spectral Lab' },
  '/qc.html': { key: 'qc', script: 'qc.js', title: 'SWARARIA AUDIO LAB // 2. Soundsystem QC & Spectral Lab' },
  '/converter': { key: 'converter', script: 'converter.js', title: 'SWARARIA AUDIO LAB // 3. Sample Rate & Playlist Converter' },
  '/converter.html': { key: 'converter', script: 'converter.js', title: 'SWARARIA AUDIO LAB // 3. Sample Rate & Playlist Converter' },
  '/organizer': { key: 'organizer', script: 'organizer.js', title: 'SWARARIA AUDIO LAB // 4. Tag & File Organizer' },
  '/organizer.html': { key: 'organizer', script: 'organizer.js', title: 'SWARARIA AUDIO LAB // 4. Tag & File Organizer' },
  '/multitrack': { key: 'multitrack', script: 'multitrack.js', title: 'SWARARIA AUDIO LAB // 5. Multitrack & Stem Splitter', css: 'splitter.css' },
  '/multitrack.html': { key: 'multitrack', script: 'multitrack.js', title: 'SWARARIA AUDIO LAB // 5. Multitrack & Stem Splitter', css: 'splitter.css' },
  '/splitter': { key: 'multitrack', script: 'multitrack.js', title: 'SWARARIA AUDIO LAB // 5. Multitrack & Stem Splitter', css: 'splitter.css' },
  '/splitter.html': { key: 'multitrack', script: 'multitrack.js', title: 'SWARARIA AUDIO LAB // 5. Multitrack & Stem Splitter', css: 'splitter.css' },
  '/video-split': { key: 'video-split', script: 'video-split.js', title: 'SWARARIA AUDIO LAB // 6. Long Video Splitter', css: 'splitter.css' },
  '/video-split.html': { key: 'video-split', script: 'video-split.js', title: 'SWARARIA AUDIO LAB // 6. Long Video Splitter', css: 'splitter.css' },
  '/player': { key: 'player', script: 'player.js', title: 'SWARARIA AUDIO LAB // 7. FOH Live Player & Cue Deck', css: ['converter.css', 'player.css', 'native-remote.css'] },
  '/player.html': { key: 'player', script: 'player.js', title: 'SWARARIA AUDIO LAB // 7. FOH Live Player & Cue Deck', css: ['converter.css', 'player.css', 'native-remote.css'] },
};

const viewCache = new Map();
let currentRoutePath = typeof window !== 'undefined' ? window.location.pathname || '/' : '/';
let isNavigating = false;

function resolveRoute(pathname) {
  let clean = pathname.replace(/\/+$/, '') || '/';
  if (ROUTE_CONFIG[clean]) return { path: clean, config: ROUTE_CONFIG[clean] };
  if (ROUTE_CONFIG[clean + '.html']) return { path: clean, config: ROUTE_CONFIG[clean + '.html'] };
  return null;
}

function ensureHeadStylesheet(cssFile) {
  if (!cssFile) return;
  const list = Array.isArray(cssFile) ? cssFile : [cssFile];
  list.forEach(file => {
    if (!file) return;
    const href = '/static/' + file;
    if (!document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    }
  });
}

function updateHeaderNavTabs(activeKey) {
  const tabs = document.querySelectorAll('.app-nav .nav-tab');
  tabs.forEach(tab => {
    const href = tab.getAttribute('href');
    const matched = resolveRoute(href);
    if (matched && matched.config.key === activeKey) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });
}

function captureCurrentView(routePath) {
  const resolved = resolveRoute(routePath);
  if (!resolved) return;

  const currentMain = document.querySelector('main.app-container');
  if (!currentMain) return;

  const currentFooter = document.querySelector('footer.app-footer');
  const modals = Array.from(document.querySelectorAll('.modal-backdrop'));

  viewCache.set(resolved.path, {
    mainEl: currentMain,
    footerEl: currentFooter,
    modalEls: modals,
    title: document.title,
    pageKey: resolved.config.key,
    scrollTop: window.scrollY || 0,
  });
}

function insertViewElements(mainEl, footerEl, modalEls) {
  const header = document.querySelector('header.app-header') || document.body.firstElementChild;
  if (header && header.parentElement === document.body) {
    header.after(mainEl);
  } else {
    document.body.prepend(mainEl);
  }

  if (footerEl) {
    mainEl.after(footerEl);
  }

  if (Array.isArray(modalEls)) {
    modalEls.forEach(m => {
      document.body.appendChild(m);
    });
  }
}

export async function spaNavigate(targetUrl, isPopState = false) {
  if (isNavigating) return;

  const parsedUrl = new URL(targetUrl, window.location.origin);
  const targetPath = parsedUrl.pathname.replace(/\/+$/, '') || '/';
  const resolved = resolveRoute(targetPath);

  if (!resolved) {
    // External or unknown URL: let browser navigate natively
    window.location.href = targetUrl;
    return;
  }

  // If already on the exact same URL and query, do nothing
  if (targetPath === currentRoutePath && parsedUrl.search === window.location.search && !isPopState) {
    return;
  }

  isNavigating = true;

  try {
    // 1. Ensure audio element and persistent dock exist before any detach
    ensureFohAudioElement();
    initPersistentDock();

    // 2. Capture and detach current view
    captureCurrentView(currentRoutePath);

    const oldMain = document.querySelector('main.app-container');
    if (oldMain && oldMain.parentElement) {
      oldMain.remove();
    }
    const oldFooters = document.querySelectorAll('footer.app-footer');
    oldFooters.forEach(f => f.remove());

    const oldModals = document.querySelectorAll('.modal-backdrop');
    oldModals.forEach(m => m.remove());

    // 3. Prepare target view
    ensureHeadStylesheet(resolved.config.css);
    ensureHeadStylesheet('player.css'); // Always ensure player.css for the floating dock

    let targetView = viewCache.get(resolved.path);

    if (targetView) {
      // Restore from cache
      insertViewElements(targetView.mainEl, targetView.footerEl, targetView.modalEls);
      document.title = targetView.title;
      document.body.dataset.page = targetView.pageKey;
      updateHeaderNavTabs(targetView.pageKey);

      if (!isPopState) {
        window.history.pushState({ path: resolved.path }, '', targetUrl);
      }
      currentRoutePath = resolved.path;

      window.scrollTo(0, targetView.scrollTop || 0);

      // Trigger wakeups if returning to player
      if (resolved.config.key === 'player') {
        window.dispatchEvent(new CustomEvent('swararia:player-activated'));
      }

      // Execute the page module on first activation. ES modules are evaluated once per URL, so this
      // is a no-op for pages whose script already ran (natively loaded or visited before).
      if (resolved.config.script) {
        await import('/static/' + resolved.config.script);
      }
    } else {
      // Fetch new HTML from server
      const res = await fetch(targetUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status} when fetching ${targetUrl}`);
      const htmlText = await res.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');

      const newMain = doc.querySelector('main.app-container');
      if (!newMain) throw new Error(`Halaman ${targetUrl} tidak memiliki elemen <main class="app-container">`);

      const newFooter = doc.querySelector('footer.app-footer');
      const newModals = Array.from(doc.querySelectorAll('.modal-backdrop'));
      const newTitle = doc.querySelector('title')?.textContent || resolved.config.title;

      insertViewElements(newMain, newFooter, newModals);
      document.title = newTitle;
      document.body.dataset.page = resolved.config.key;
      updateHeaderNavTabs(resolved.config.key);

      if (!isPopState) {
        window.history.pushState({ path: resolved.path }, '', targetUrl);
      }
      currentRoutePath = resolved.path;

      viewCache.set(resolved.path, {
        mainEl: newMain,
        footerEl: newFooter,
        modalEls: newModals,
        title: newTitle,
        pageKey: resolved.config.key,
        scrollTop: 0,
      });

      window.scrollTo(0, 0);

      // Dynamically load page module
      if (resolved.config.script) {
        await import('/static/' + resolved.config.script);
      }
    }

    // Notify listeners
    window.dispatchEvent(
      new CustomEvent('swararia:route-changed', {
        detail: { path: resolved.path, key: resolved.config.key },
      })
    );
  } catch (err) {
    console.error('[SPA Router] Navigation error:', err);
    // Fallback: full browser navigation
    window.location.href = targetUrl;
  } finally {
    isNavigating = false;
  }
}

export function initSpaRouter() {
  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
  const resolved = resolveRoute(currentPath);
  currentRoutePath = resolved ? resolved.path : currentPath;

  if (resolved && typeof document !== 'undefined' && document.body) {
    document.body.dataset.page = resolved.config.key;
  }

  // Ensure persistent dock and audio element exist
  ensureFohAudioElement();
  ensureHeadStylesheet('player.css');
  initPersistentDock();

  // Adopt current page into view cache
  captureCurrentView(currentRoutePath);

  // Expose global bridge
  window.__spaNavigate = spaNavigate;

  // Intercept all internal navigation clicks
  document.addEventListener('click', (e) => {
    // Only intercept primary left clicks without modifier keys
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    const link = e.target.closest('a[href]');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) {
      return;
    }

    const targetAttr = link.getAttribute('target');
    if (targetAttr && targetAttr !== '_self') return;

    try {
      const url = new URL(href, window.location.origin);
      if (url.origin !== window.location.origin) return;

      const resolved = resolveRoute(url.pathname);
      if (resolved) {
        e.preventDefault();
        spaNavigate(url.pathname + url.search + url.hash);
      }
    } catch (_err) {
      // Ignore invalid URLs
    }
  });

  // Handle browser Back / Forward buttons
  window.addEventListener('popstate', (e) => {
    const popPath = window.location.pathname.replace(/\/+$/, '') || '/';
    spaNavigate(popPath + window.location.search, true);
  });

  // Background preload Stage 7 FOH Player if current page is not player
  if (resolved && resolved.config.key !== 'player') {
    setTimeout(preloadPlayerConsole, 600);
  }
}

async function preloadPlayerConsole() {
  if (viewCache.has('/player')) return;
  try {
    const res = await fetch('/player');
    if (!res.ok) return;
    const htmlText = await res.text();
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const main = doc.querySelector('main.app-container');
    const footer = doc.querySelector('footer.app-footer');
    const modals = Array.from(doc.querySelectorAll('.modal-backdrop'));
    const title = doc.querySelector('title')?.textContent || 'SWARARIA AUDIO LAB // 7. FOH Live Player';

    if (main) {
      viewCache.set('/player', {
        mainEl: main,
        footerEl: footer,
        modalEls: modals,
        title,
        pageKey: 'player',
        scrollTop: 0,
      });
      // Only cache the markup here. Do NOT import player.js yet: its DOMContentLoaded handler would run
      // immediately (see the safe-DOMContentLoaded hook in ui-shared.js) against the page currently shown,
      // re-rendering the header with "FOH Player" active and setting body[data-page="player"].
      // The module is imported on first navigation to /player instead.
    }
  } catch (_e) {
    // Preload failure is non-critical
  }
}

