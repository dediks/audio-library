// Only native v1 commands enter here. Legacy/local player actions stay unchanged.
// Injection keeps actual media observations testable without replacing the engine.
export function createNativeCommandConsumer({ media, hasTrack, execute, isFadingOut = () => false, currentTrackId = () => null, activeGroupId = () => null, captureIntent = () => () => true, authorize = async () => false, now = () => Date.now() / 1000 }) {
  const seen = new Map();
  const allowedActions = ['play', 'pause', 'stop', 'fade_out', 'prev', 'next', 'select_track', 'select_group'];
  return async cmd => {
    if (!cmd || typeof cmd.native_id !== 'string') return null;
    for (const [id, expiry] of seen) if (now() >= expiry) seen.delete(id);
    if (seen.has(cmd.native_id)) return null;
    if (seen.size >= 256) return { command_id: cmd.native_id, status: 'rejected' };
    seen.set(cmd.native_id, now() + 300);
    const result = status => ({ command_id: cmd.native_id, status });
    if (!Number.isFinite(cmd.expires_at) || now() >= cmd.expires_at) return result('expired');
    if (!allowedActions.includes(cmd.action) || !media()) return result('rejected');
    if (cmd.action === 'select_track') {
      if (!cmd.params || typeof cmd.params.track_id !== 'string' || !cmd.params.track_id) return result('rejected');
    } else if (cmd.action === 'select_group') {
      if (!cmd.params || typeof cmd.params.group_id !== 'string' || !cmd.params.group_id) return result('rejected');
    } else if (!hasTrack()) {
      return result('rejected');
    }
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
          return Promise.resolve(execute(cmd.action, playbackGuard, cmd)).then(value => value === false ? 'rejected' : 'completed');
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
      const trackId = currentTrackId() || null;
      const groupId = activeGroupId() || null;
      let applied = false;
      if (cmd.action === 'play') applied = playing;
      else if (cmd.action === 'stop') applied = stopped;
      else if (cmd.action === 'fade_out') applied = playing && fading;
      else if (cmd.action === 'select_track') {
        applied = Boolean(trackId && trackId === cmd.params?.track_id && (cmd.params?.auto_play ? playing : paused));
      } else if (cmd.action === 'select_group') {
        applied = Boolean(groupId && groupId === cmd.params?.group_id);
      } else if (cmd.action === 'prev' || cmd.action === 'next') {
        applied = Boolean(trackId && hasTrack());
      } else {
        applied = paused;
      }
      return { ...result(applied ? 'applied' : 'rejected'), observed: {
        is_playing: playing,
        current_time: Number.isFinite(audio?.currentTime) ? audio.currentTime : null,
        transport_state: fading ? 'FADING' : stopped ? 'STOPPED' : playing ? 'PLAYING' : 'PAUSED',
        track_id: trackId,
        active_group_id: groupId,
      } };
    } catch (_) {
      return result('rejected');
    } finally {
      cancelled = true;
      clearTimeout(timer);
    }
  };
}
