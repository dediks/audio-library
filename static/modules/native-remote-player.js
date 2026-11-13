// Only native v1 commands enter here. Legacy/local player actions stay unchanged.
// Injection keeps actual media observations testable without replacing the engine.
export function createNativeCommandConsumer({ media, hasTrack, execute, isFadingOut = () => false, captureIntent = () => () => true, authorize = async () => false, now = () => Date.now() / 1000 }) {
  const seen = new Map();
  return async cmd => {
    if (!cmd || typeof cmd.native_id !== 'string') return null;
    for (const [id, expiry] of seen) if (now() >= expiry) seen.delete(id);
    if (seen.has(cmd.native_id)) return null;
    if (seen.size >= 256) return { command_id: cmd.native_id, status: 'rejected' };
    seen.set(cmd.native_id, now() + 300);
    const result = status => ({ command_id: cmd.native_id, status });
    if (!Number.isFinite(cmd.expires_at) || now() >= cmd.expires_at) return result('expired');
    if (!['play', 'pause', 'stop', 'fade_out'].includes(cmd.action) || !media() || !hasTrack()) return result('rejected');
    // Reserve ordering synchronously, before even the first authorization yields.
    const isIntentCurrent = captureIntent();
    let timer;
    let cancelled = false;
    const isCurrent = () => !cancelled && now() < cmd.expires_at && isIntentCurrent();
    const playbackGuard = {
      isCurrent,
      authorize: async () => isCurrent() && await authorize(cmd) && isCurrent(),
    };
    try {
      // No automatic retry/replay. A stalled operation has an unknown outcome.
      const completed = await Promise.race([
        Promise.resolve().then(async () => {
          if (!await authorize(cmd)) return 'rejected';
          // Recheck after yielding, immediately before touching the audio engine.
          if (!isIntentCurrent()) return 'rejected';
          if (!isCurrent()) return 'expired';
          return Promise.resolve(execute(cmd.action, playbackGuard)).then(value => value === false ? 'rejected' : 'completed');
        }),
        new Promise(resolve => { timer = setTimeout(() => { cancelled = true; resolve('unknown'); }, Math.max(1, (cmd.expires_at - now()) * 1000)); }),
      ]);
      if (completed !== 'completed') return result(completed);
      if (now() >= cmd.expires_at) return result('unknown');
      const audio = media();
      const fading = Boolean(isFadingOut());
      const playing = Boolean(audio && !audio.paused && !audio.ended && !audio.error && audio.readyState >= 2);
      const paused = Boolean(audio && audio.paused);
      const stopped = paused && audio.currentTime === 0;
      const applied = cmd.action === 'play' ? playing : cmd.action === 'stop' ? stopped : cmd.action === 'fade_out' ? (playing && fading) : paused;
      return { ...result(applied ? 'applied' : 'rejected'), observed: {
        is_playing: playing,
        current_time: Number.isFinite(audio?.currentTime) ? audio.currentTime : null,
        transport_state: fading ? 'FADING' : stopped ? 'STOPPED' : playing ? 'PLAYING' : 'PAUSED',
      } };
    } catch (_) {
      return result('rejected');
    } finally {
      cancelled = true;
      clearTimeout(timer);
    }
  };
}
