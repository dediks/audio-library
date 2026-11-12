# Handoff — Android Remote desktop UI V1

## Scope
Implemented production frontend for Nonaktif → Pairing → Persetujuan → Terhubung using real native-admin API state. Advanced IP/port/security settings remain collapsed; active fields reflect the actual endpoint after reload, while inactive edits survive polling. Invitation expiry, permission changes, mixed devices, revocation and manual-copy fallback use existing APIs. Pairing controls are compact and use one manual-code disclosure.

Branch: `feature/dual-browser-native-remote-v1`. Base: `f716c0c310888d167e547b4000867189f0c24376`. Final commit identifier is recorded in the release manifest outside the source archive; this document is not a publication receipt.

## Verified and preserved
- Parent stable gates: Python 74/74, native-admin 11/11, strict-unhandled native-player and dual-remote Node harnesses; JavaScript syntax and staged whitespace.
- Actual Chromium and loopback API/TLS checks covered all four states, missing-IP focus, pairing, approval, role changes, mixed devices, denial, expiry, revocation, endpoint reload and stop. Images of live pairing use a completely opaque QR redaction; no pairing secret is included.
- Desktop rendering inspected at 1100×900; connected narrow layout at 390×844 has no horizontal overflow and keeps the footer visible. These are browser checks, not Android-device rendering claims.
- 93 pre-existing files unchanged outside the four declared tracked-file edits; all 22 approved preview files unchanged. Legacy browser modal/setup and all 25 controls retained; backend/API/TLS, main player, audio and Android untouched.
- Temporary fixture stopped, metadata removed and HTTP/TLS test ports verified closed. No installation, firewall, certificate-store or WSL bridge change.
- `verification/native-ui-v1-tdd.json` is the original implementer 8-test checkpoint. `native-ui-v1-parent.json` records later 11-test corrections and completed real-browser/API acceptance. Initial review is preserved separately; promotion requires the final independent review bound to the final candidate.

## Source handoff and manual push
The release includes a source ZIP made only from the final Git tree, plus a binary-capable patch from the base above. The ZIP does not include untracked design previews, live fixture, TLS keys, sessions, virtualenv or generated application data. Verify hashes and the commit in the adjacent release manifest. The patch is for a clean checkout at the specified base; do not apply it on top of an already updated tree.

On the VPS checkout, after reviewing the release commit, publication remains the user's action:

```sh
git push origin feature/dual-browser-native-remote-v1
```

No merge or push is performed by the agent. Source completion does not update GitHub, the laptop checkout, a running application or an installed Windows application. Updating a source-run app requires the correct checkout and restart; an installer rebuild is outside this change.

## Remaining device acceptance
Physical Windows/WSL-to-phone connectivity, external scanner/manual paste on the phone, system font scaling and real audio remain unverified. The native UI does not configure LAN routing or make legacy HTTP/PIN secure. Keep the legacy browser path on a trusted LAN, not the public internet.

## Rollback
Preserve newer work and use a scoped `git revert <UI-release-commit>` if rollback is requested. Do not reset the whole checkout, uninstall Android, clear collections or alter app signing. Recovery bundle and approved-preview backup paths and tested-restore evidence are in `verification/native-ui-v1-baseline.json`.
