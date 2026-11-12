# Android Remote UI V1 implementation — approved scope

Status: implementation in progress after explicit user instruction to proceed; no new design/installation/publication approval is inferred. Reuse the existing feature branch rather than creating another branch for this related UI revision.

## Base and recovery
- Base f716c0c310888d167e547b4000867189f0c24376, feature/dual-browser-native-remote-v1.
- Read-only live remote lookup confirmed feature atf716c0c and main at20702751 (feature not merged).
- Source bundle plus isolated clone/core-file comparison verified; approved22-file preview separately ZIP-backed and byte/CRC checked. Paths/hashes and full immutable source/preview inventories in verification/native-ui-v1-baseline.json.
- Dependency-complete baseline rerun:74/74 Python and all3Node harnesses pass. Cached yt-dlp zipimport is an existing per-command test environment, not an installation.

## Acceptance
- Implement the approved source-styled preview's primary flow: Nonaktif → Pairing → Persetujuan → Terhubung. Preserve real enabled-but-idle/expired/error/loading states; never invent a successful connection or device.
- Existing colors, fonts, modal/button/device components and offline QR renderer. IP, port and fingerprint under progressive disclosure. Missing IP opens settings/focuses input instead of guessing a reachable address. WSL help is conditional guidance, not fabricated detection/reachability or automatic bridge/firewall configuration.
- Real API snapshots drive state, QR/string validity, pending requests, roles and active devices. Mixed pending/active devices stay manageable; expiry/revocation remove stale access controls and pairing material. No credentials in URL/log/storage, no optimistic permission success.
- Maintain typed settings, focus and feedback through silent polling. Busy/repeated-click guards, mapped errors and clipboard fallback remain. Clipboard handler checks current valid invite again. No new global timer or race that can resurrect old invitation/roles.
- APK0.5 has no in-app QR scanner: retain honest external-text-scanner/manual-paste guidance, not an unsupported scanning action.
- Only Native modal/admin frontend and native-scoped CSS plus focused tests change. Original browser modal/setup/25 controls, player logic, audio, backend/TLS/API, Android source/APK and dependencies remain byte-identical where outside the declared UI boundary.
- Do not modify approved design/android-remote-preview-v1 artifacts; retain them as the immutable design reference, not production mock data.

## Explicit exclusions
No new library, CA/trust-store installation, domain/cloud/account, native protocol, audio/queue logic, data/schema change, firewall/WSL bridge action, public listener, Android build, installer build, automatic merge or push. Legacy browser HTTP/PIN risk stays as previously accepted; this UI change does not secure that independent path.

## Verification/release
Use vertical TDD on actual Native admin rendering/actions. Run targeted state tests, then stable-candidate Python/browser/native/mixed-controller regressions and syntax/whitespace checks. Inspect actual Chromium rendering and real loopback API-driven states separately from mocked module tests; redact all live pairing strings/QR before storing screenshots or messages. Test input preservation, failures, expiries, multiple device states and no effects on browser. All live fixtures explicit127.0.0.1 with WSL privileged helpers mocked, never launcher defaults.

Freeze the candidate, independent review, local commit and verified source/patch handoff. Physical Windows/WSL/HP connectivity, scanner support and audio remain device gates; no passing host UI test should imply those are complete. User pushes manually.

## Rollback
Preserve newer user work, then scoped revert to the f716c0c UI/backend baseline if requested. UI rollback does not restore/change collections, installed applications or phone state. No uninstall, clear-data or whole-tree reset. Recovery artifacts are source-level same-host backups, not off-host data protection.
