# Secure Native Remote foundation — desktop v1

Status: integrated source, not a release/installer. Desktop only; no Android changes.
Base: `20702751ff2fdea5ace7d131dbaed7c0727d3c6c` on `feature/secure-native-remote-v1`.

## Operator flow / compatibility

The workstation HTTP UI is now **127.0.0.1 only** (preferred port 8765; its existing local free-port fallback remains). Both launchers own and close the native listener. No firewall, port forwarding, or WSL bridge is created/modified. Legacy plaintext LAN browser/PIN remote access is intentionally removed. Legacy info/state GET and command/clients/WSL bridge POST return 410 locally; nonlocal HTTP requests are rejected. Do not use old HTTP/PIN instructions as a fallback.

Open Player → HP Remote. Enter an IPv4 address assigned to the PC in RFC1918 LAN space, then **Aktifkan HTTPS**. Default port 8766; a bind conflict is an explicit error, not another port. Wildcard/public/link-local/hostname/IPv6 binds are rejected. Loopback and port 0 on loopback are supported for isolated testing only. The API serves no media, library, files, download, streaming, EQ, volume, seek, or static assets.

The modal shows the session certificate's SHA-256 fingerprint, one-time 90-second invite, offline QR/manual pairing string, pending approvals, roles, and revocation. A native client is required; this change does not deliver a mobile app. The existing offline QR renderer is reused. Pairing string format:

```text
swararia1|IPv4:port|base64url-SHA256-DER-no-padding|invite
```

This is out-of-band pairing data, **not a navigable URL**. Client must match the certificate fingerprint to the PC display **before sending the invite or any token**, pin that exact certificate/session, and retain hostname/IP SAN verification. Never globally trust all certificates or disable TLS/hostname checks. A plain system-trust client correctly rejects this self-signed session certificate. New start creates a new certificate and identity namespace; re-pair after restart. Do not send secrets in query strings or log them.

TLS uses ephemeral EC P-256/self-signed SHA-256 certificates, IP SAN, minimum TLS 1.2. Certificate lifetime 12h; device grant lifetime 8h (pending approval 120s). RAM-only invite/token hashes/identities. Private key files are created only inside a private temporary directory, loaded into SSLContext, then removed **before accepting connections**. POSIX permissions are directory 0700/files 0600. On Windows, TLS fails closed on Python <3.12.4 to avoid old temporary-directory ACL behavior; use a supported patched packaging runtime. Windows ACL/runtime/installer behavior has **not** been exercised here. Python RAM is not claimed to be securely zeroized.

## Native HTTPS contract

Every response is JSON, no-store, connection-close. No redirects or CORS/browser clients. Reject browser Origin/Fetch Metadata on the native API. Exact routes only; query/encoded/extra-slash variants are not accepted. POST requires one nonnegative decimal Content-Length (max 4096), exactly application/json, object JSON with unique keys/no nonfinite constants, no Transfer-Encoding. Unexpected fields are rejected.

- `POST /v1/pair`: `Authorization: Bearer <one-time invite>`; body `{"label":"operator device"}` (1–80 characters). 202 returns `device_id`, random `token`, `status:pending`. Invite consumed atomically. Token is issued only once; losing the response requires a new local invite. Pending token cannot read playback or command. Operator approves control/view_only or denies locally.
- `GET /v1/session`: Bearer device token; reports pending/active role and expiration. Revoked/denied/expired tokens return explicit 403 code; missing/bad tokens 401. Listener shutdown means disabled/transport unavailable, not playback failure.
- `GET /v1/capabilities`: approved token; protocol `v1`, commands `play/pause/stop`, media false, command/idempotency TTLs.
- `GET /v1/state`: approved token; role, master_online, playback booleans/transport/time/duration and `state.track_title`. The optional display title is a printable basename, capped at160 characters; URL-shaped values are omitted. No track paths, folders, QC or other library metadata.
- `POST /v1/commands`: approved **control** token; `{"action":"play|pause|stop","idempotency_key":"8-to-80_ASCII_letters_digits_underscore_hyphen"}`. 202 is **accepted**, not applied. Same key + device + session repeats the existing record; changing action returns 409. Distinct device/session does not share keys. Offline master rejects early (409).
- `GET /v1/commands/<command_id>`: approved token, only its own records. Status accepted/pending/applied/rejected/expired/unknown. Unknown ID, another device's ID, or forgotten records yield unknown, not evidence of execution.

Limits: 32 device records/session, 256 command records, records retained 300s; capacity rejects instead of evicting idempotency entries early. Pair rate bucket 10 burst + 1/6s refill; global request bucket 120 burst + 20/s refill; fixed bucket count. Max 16 live connections, three-second socket/handshake idle timeout, six-second absolute connection deadline, bounded request queue, one request per TLS connection. Listener/worker/watchdog threads are daemonized and sockets closed during shutdown. Saturation may close the transport without a JSON response: client must report unknown, not auto-replay.

## Local administration and actual execution

`GET /api/native-remote`, `POST /api/native-remote` are local only: actual loopback peer, exact localhost/127.0.0.1 Host + port, same-origin Origin (required for writes), no cross-/same-site Fetch Metadata, application/json writes. Host/Forwarded/X-Forwarded-For/tags do not grant authorization. Actions: start(bind_ip, optional port=8766), stop, invite_open, invite_close, approve(device_id,role), deny(device_id), revoke(device_id). No auth state is stored in user collections or localStorage.

The existing `RemotePlayerHub` queue and local JS audio engine are reused. Player POST `/api/remote/state` every ~350ms includes state, stable per-page `master_instance`, and `native_acks`. New master instance or >=2s heartbeat gap rejects queued work and leaves already delivered work unknown; it is never requeued after reopening. Queue delivery changes accepted→pending. Before execution the JS consumer checks TTL and rechecks current permission via local `POST /api/native-remote/claim` (command_id, master_instance), then invokes existing playCurrentTrack/pauseCurrentTrack/stopAndResetCue. No-track is rejected rather than auto-selecting media.

Ack is sent only after observing actual media state/result. Rejected HTMLAudio.play(), unready media, no-track, deadline, missing permission, and lost transport cannot turn into applied. Stop requires observed paused + time zero. No ack after delivery becomes unknown; undelivered expired work becomes expired. Revocation/downgrade cancels queued work and treats in-flight work honestly as unknown. It cannot undo an audio action already begun; disabling/revoking/disconnecting never sends Stop. Idempotency is bounded duplicate suppression, **not exactly-once delivery**. Clients must not auto-replay uncertain work.

## Verification / packaging / rollback

See `verification/native-remote-final.json` and `verification/native-remote-tests.txt` for actual commands/results; `verification/native-remote-tdd.json` records observed tracer-bullet RED/GREEN checkpoints. Node uses fake media observations plus execution of the real player polling function, not only source matching. A real local browser also exercised start/invite/QR/pending approval/revoke/stop and command accepted→rejected with no loaded track.

`requirements.txt` pins cryptography==50.0.2; PyInstaller spec explicitly includes secure modules/cryptography native runtime. Parent installed cryptography50.0.2/cffi2.1.1/pycparser3.12 only in the isolated local `.venv`; no system/Hermes environment upgrade or installer/build toolchain was run. Source/app version remains unchanged; native capabilities signal protocol v1 independently. Windows packaging, certificate pinning by an actual mobile client, real LAN/device playback acceptance remain operator gates.

Rollback before commit: review the scoped diff, preserve any later work, restore only changed tracked source/config files from the base commit and remove only listed new native source/tests/docs/evidence. Do not reset the whole working tree or delete user library/media. After a parent commit, prefer a scoped revert. Pre-change recovery bundle is outside the repo at `/home/ubuntu/.local/share/swararia-private-backups/desktop-before-native-remote-20261112T050724081948Z.bundle`; parent restored it into an isolated scratch clone and verified the baseline commit and source objects. This verifies source recovery, not a Windows installer or user-library restore. Reverting restores the legacy insecure remote behavior, so do not expose it to LAN/internet.
