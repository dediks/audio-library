/**
 * Audio Lab - Shared HTTP JSON Client Wrapper
 * Centralizes fetch, JSON parsing, and structured error extraction.
 */

/**
 * Performs a GET request and returns a normalized response object.
 * @param {string} url
 * @returns {Promise<{ ok: boolean, status: number, data: any, error: string | null }>}
 */
export async function apiGet(url) {
  try {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    return {
      ok: res.ok,
      status: res.status,
      data,
      error: res.ok ? null : (data.error || `HTTP ${res.status}`),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: {},
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Performs a JSON POST request and returns a normalized response object.
 * @param {string} url
 * @param {Record<string, any>} [payload]
 * @returns {Promise<{ ok: boolean, status: number, data: any, error: string | null }>}
 */
export async function apiPost(url, payload = {}) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return {
      ok: res.ok,
      status: res.status,
      data,
      error: res.ok ? null : (data.error || `HTTP ${res.status}`),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: {},
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

