# Additive browser + native Remote correction

## Approved scope — supersedes the earlier HTTPS-browser proposal
User explicitly requested: keep the HP browser remote unchanged and add native Android connection alongside it. User approved restoring the old HTTP/PIN path after disclosure that native HTTPS does NOT secure that path. Do not ask for/install a phone CA, redesign the browser, invent a browser TLS migration, or treat three native buttons as browser parity.

- Desktop source only, branch feature/dual-browser-native-remote-v1; no Android changes/APK rebuild.
- Restore original browser URL/PIN/QR, UI/modal, simulator,25 controls, roles/kick and existing operator-driven WSL bridge controls from20702751.
- Separate Android Remote button/modal; existing HTTPS v1 stays defaultOFF/manualON with the same pinning, approval, roles, expiry, revocation and command status protocol.
- No new dependencies, device certificates, trust-all/global SSL changes, cloud/domain/account requirements, installer build, merge or push.
- Do not execute Windows bridge/firewall actions or open wildcard/public listeners on VPS. Tests must explicitly bind127.0.0.1, even when verifying restored legacy launch defaults by substitution/inspection.

## Recovery and baseline
- Base: 3f872241e526cf839cd843a90cfd568424cb1149.
- Browser reference: 20702751ff2fdea5ace7d131dbaed7c0727d3c6c.
- Recovery bundle: /home/ubuntu/.local/share/swararia-private-backups/desktop-before-dual-remote-20261112T121340978439Z.bundle.
- SHA256: 3649b0cbdc25068f83e5ffd46b2aeecb8c531930ddf68781d9242b01efa9ee50.
- Bundle verified and isolated clone/head/core-source byte comparison passed.
- Dependency-complete baseline:68/68 Python tests, native-admin and native-player Node harnesses pass. Existing cached yt-dlp archive is a per-command test environment only, not a new runtime dependency or installation.
- Implementation assigned to one bounded writer; independent frozen-candidate review and parent verification precede any release commit.

## Browser parity inventory
AST of original web_ui.py found25 allowed actions: assign_pad, clear_pad, cue_zero, fade, load_track, next, nudge, pause, play, play_pause, prev, reset_eq, reset_peak, restart_pad, seek_ratio, select_playlist, set_autotrim, set_eq, set_play_mode, set_preamp, set_routing, set_volume, stop, toggle_mute, trigger_pad.
Reuse the original deck functions and modal/event handlers rather than another playback engine. Browser operates without the Android app, and audio stays on PC. Preserve its original LAN read allowlist and prevent arbitrary workstation/filesystem mutations from LAN; do not expand that allowlist under this correction.

## Coexistence acceptance
- Real peer/Host/Origin/FetchMetadata protection remains on native administration/claim and native-sensitive master acknowledgements; forged forwarding headers or LAN browser access must not reach them.
- Reuse the existing queue once per poll. Mixed legacy/native delivery must not drain twice, duplicate delivery, expose native session secrets or turn queued work into falsely-applied results. Old master payloads without native identity must never execute native commands as unguarded legacy work.
- Browser counts/PIN/device management remain browser-specific. Resetting browser PIN/disabling browser must not clear queued native work; native revoke/stop must not alter browser enablement or stop PC audio.
- Existing synchronous transport intent reservation, actual playback cancellation/deadline/authorization checks and no replay remain. Browser/local Stop, Play or track changes cannot allow an older delayed native Play to resurrect.
- Native UI initialization and polling only on local PC main player; phone/simulator retain their original browser UI and do not fetch native administration.

## Security boundaries and limitations
Retained browser behavior includes plaintext LAN HTTP/PIN and its legacy credential storage/QR semantics. It is not equivalent to pinned native HTTPS, and this correction does not claim universal encrypted or strongly authenticated control. Use only on a trusted LAN; never expose to internet. Request logging must not leak native invite/token credentials. No physical phone, Windows installer/runtime, WSL networking or real sound output is proven by host tests.

The abandoned HTTPS-browser investigation found that the existing self-signed leaf is not trusted by default system TLS and native API intentionally rejects browser headers. Android0.5 also requires a single self-signed EC leaf. These observations justify leaving native identity/contract alone; they are NOT a requirement to install a CA under the approved correction.

## Verification and handoff gates
Run vertical RED→GREEN restoration tests, full Python discovery, existing and additional Node actual-function/mixed-controller checks, syntax/compile and whitespace checks. Explicitly replace obsolete410/loopback-only acceptance assertions with approved compatibility behavior while preserving native guards. Check original browser modal/function parity,25-action dispatch and unchanged native modules/engine files. Label simulated LAN/host tests separately from device acceptance. Freeze exact code bytes, independent review, then local commit and verified private source/patch; user pushes manually.

## Rollback
Preserve subsequent user work and prefer a scoped revert rather than reset/rewrite of shared history. Source rollback cannot restore phone/library data or an installer; neither is modified here. Reverting to3f87224 removes legacy browser compatibility again, so explain that consequence before a requested rollback. No phone trust-store removal is needed: no certificate was installed.
