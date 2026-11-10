/**
 * Audio Lab - Shared Queue Monitor & Automatic Per-Task Notification Poller
 * Strict DOM Manipulation (No innerHTML, strictly textContent & createElement)
 */

import { notify } from './notifications.js';
import { apiGet } from './api-client.js';

const NOTIF_SEEN_TASKS_KEY = 'audio_lab_seen_tasks';

let currentLogFilter = 'all';
let cachedLogLines = [];

export function setLogFilter(mode) {
  currentLogFilter = mode;
  const terminalEl = document.getElementById('terminalLogs');
  if (terminalEl) renderLogs(terminalEl, cachedLogLines);
}

/**
 * Replaces terminal container contents with an array of log strings.
 * Supports filtering into an 'errors' group.
 * @param {HTMLElement | null} terminalEl
 * @param {string[]} logs
 */
export function renderLogs(terminalEl, logs) {
  if (!terminalEl || !Array.isArray(logs)) return;
  cachedLogLines = logs;

  const errorCountBadge = document.getElementById('termErrorCount');
  const errorLines = [];
  const allLines = [];

  logs.forEach(msg => {
    let lvl = 'info';
    if (msg.includes('ERROR') || msg.includes('Failed') || msg.includes('Error:')) {
      lvl = 'error';
    } else if (msg.includes('WARNING') || msg.includes('SKIPPED') || msg.includes('FALLBACK') || msg.includes('caution')) {
      lvl = 'warn';
    }
    const item = { msg, lvl };
    allLines.push(item);
    if (lvl === 'error' || lvl === 'warn') {
      errorLines.push(item);
    }
  });

  const actualErrorCount = errorLines.filter(x => x.lvl === 'error').length;
  if (errorCountBadge) {
    if (actualErrorCount > 0) {
      errorCountBadge.textContent = String(actualErrorCount);
      errorCountBadge.classList.remove('hidden');
    } else {
      errorCountBadge.classList.add('hidden');
    }
  }

  terminalEl.replaceChildren();

  if (currentLogFilter === 'errors') {
    if (errorLines.length === 0) {
      const p = document.createElement('p');
      p.className = 'log-line info';
      p.textContent = '[INFO] Tidak ada error atau peringatan pada proses ini.';
      terminalEl.appendChild(p);
    } else {
      const banner = document.createElement('div');
      banner.className = 'terminal-error-banner';
      const icon = document.createElement('span');
      icon.className = 'banner-icon';
      icon.textContent = '⚠️';
      const text = document.createElement('span');
      text.textContent = `Error Group: Menampilkan ${errorLines.length} baris catatan (${actualErrorCount} error):`;
      banner.appendChild(icon);
      banner.appendChild(text);
      terminalEl.appendChild(banner);

      errorLines.forEach(({ msg, lvl }) => {
        const p = document.createElement('p');
        p.className = 'log-line ' + lvl;
        p.textContent = msg;
        terminalEl.appendChild(p);
      });
    }
  } else {
    allLines.forEach(({ msg, lvl }) => {
      const p = document.createElement('p');
      p.className = 'log-line ' + lvl;
      p.textContent = msg;
      terminalEl.appendChild(p);
    });
  }

  terminalEl.scrollTop = terminalEl.scrollHeight;
}

function getSeenTaskIds() {
  try {
    const raw = sessionStorage.getItem(NOTIF_SEEN_TASKS_KEY);
    if (raw === null) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch (_) {
    return new Set();
  }
}

function saveSeenTaskIds(setObj) {
  try {
    const arr = Array.from(setObj).slice(-60);
    sessionStorage.setItem(NOTIF_SEEN_TASKS_KEY, JSON.stringify(arr));
  } catch (_) {
    // Ignore storage errors
  }
}

function mapTaskOutcomeToNotifType(outcome, status) {
  if (outcome === 'ALREADY_EXISTS') return 'exists';
  if (outcome === 'PARTIAL' || outcome === 'WARNING') return 'warning';
  if (outcome === 'FAILED' || status === 'FAILED') return 'error';
  return 'success';
}

/**
 * Creates a reusable queue state poller for /api/queue with automatic per-task notifications.
 * @param {{
 *   queueCounter?: HTMLElement | null,
 *   jobStatusTag?: HTMLElement | null,
 *   jobUrlLabel?: HTMLElement | null,
 *   progressFill?: HTMLElement | null,
 *   progressText?: HTMLElement | null,
 *   terminalLogs?: HTMLElement | null,
 *   onActive?: (current: any, data: any) => void,
 *   onTaskFinished?: (task: any, data: any) => void,
 *   onIdle?: (wasJobRunning: boolean, data: any) => void,
 *   onSnapshot?: (data: any) => void
 * }} opts
 */
export function createQueueMonitor(opts = {}) {
  let wasJobRunning = false;
  let lastNotifiedTask = null;

  async function poll() {
    const { ok, data } = await apiGet('/api/queue');
    if (!ok) return;

    const historyList = Array.isArray(data.history) ? data.history : [];
    let seenSet = getSeenTaskIds();
    if (seenSet === null) {
      // First poll in this browser session: seed existing history IDs without firing old toasts
      seenSet = new Set(historyList.map(t => t && t.id).filter(Boolean));
      saveSeenTaskIds(seenSet);
    } else {
      // Check from oldest to newest among unseen history entries
      const unseenTasks = historyList.filter(t => t && t.id && !seenSet.has(t.id)).reverse();
      if (unseenTasks.length > 0) {
        unseenTasks.forEach(task => {
          seenSet.add(task.id);
          lastNotifiedTask = task;
          const notifType = mapTaskOutcomeToNotifType(task.outcome, task.status);
          const fallbackTitle = task.type === 'resample'
            ? (task.status === 'FAILED' ? 'Konversi Gagal' : 'Konversi Selesai')
            : (task.status === 'FAILED' ? 'Unduhan Gagal' : 'Unduhan Selesai');
          const fallbackSummary = task.error || task.url || 'Tugas selesai diproses.';

          notify({
            type: notifType,
            title: task.title || fallbackTitle,
            message: task.summary || fallbackSummary,
            playSound: true,
          });

          if (typeof opts.onTaskFinished === 'function') {
            opts.onTaskFinished(task, data);
          }
        });
        saveSeenTaskIds(seenSet);
      }
    }

    if (typeof opts.onSnapshot === 'function') {
      opts.onSnapshot(data);
    }

    const queueLen = (data.queue || []).length;
    if (opts.queueCounter) {
      opts.queueCounter.textContent = 'Antrian: ' + queueLen;
    }

    const current = data.current;
    if (current) {
      wasJobRunning = true;
      if (opts.jobStatusTag) {
        opts.jobStatusTag.textContent = current.status || 'PROCESSING';
        opts.jobStatusTag.className = 'job-status-tag active';
      }
      if (opts.jobUrlLabel) {
        opts.jobUrlLabel.textContent = current.url;
        opts.jobUrlLabel.title = current.url;
      }

      const p = Math.round(current.progress || 0);
      if (opts.progressFill) {
        opts.progressFill.style.width = p + '%';
      }
      if (opts.progressText) {
        opts.progressText.textContent = p + '% Complete';
      }

      if (opts.terminalLogs && Array.isArray(current.logs) && current.logs.length > 0) {
        renderLogs(opts.terminalLogs, current.logs);
      }

      if (typeof opts.onActive === 'function') {
        opts.onActive(current, data);
      }
    } else {
      const recentTask = lastNotifiedTask || historyList[0] || null;
      if (opts.jobStatusTag) {
        if (recentTask && lastNotifiedTask) {
          const out = recentTask.outcome || recentTask.status;
          if (out === 'ALREADY_EXISTS') {
            opts.jobStatusTag.textContent = 'SUDAH ADA';
            opts.jobStatusTag.className = 'job-status-tag exists';
          } else if (out === 'FAILED' || recentTask.status === 'FAILED') {
            opts.jobStatusTag.textContent = 'GAGAL';
            opts.jobStatusTag.className = 'job-status-tag error';
          } else if (out === 'WARNING' || out === 'PARTIAL') {
            opts.jobStatusTag.textContent = 'SELESAI (CATATAN)';
            opts.jobStatusTag.className = 'job-status-tag active';
          } else {
            opts.jobStatusTag.textContent = 'SELESAI';
            opts.jobStatusTag.className = 'job-status-tag success';
          }
        } else {
          opts.jobStatusTag.textContent = 'IDLE';
          opts.jobStatusTag.className = 'job-status-tag';
        }
      }
      if (opts.jobUrlLabel && lastNotifiedTask && lastNotifiedTask.summary) {
        opts.jobUrlLabel.textContent = lastNotifiedTask.summary;
        opts.jobUrlLabel.title = lastNotifiedTask.summary;
      }
      if (queueLen === 0) {
        const justFinished = wasJobRunning;
        wasJobRunning = false;
        if (typeof opts.onIdle === 'function') {
          opts.onIdle(justFinished, data);
        }
      }
    }
  }

  return { poll };
}

