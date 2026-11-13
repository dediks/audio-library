# Desktop Native Remote reliability — source handoff

Base: `b3b9ced44df87bafc950af0bb39beea5d026399b`.
Branch retained: `feature/dual-browser-native-remote-v1`.
The final commit and package hashes are recorded in the adjacent release manifest; the bound independent verdict is in `verification/remote-reliability-final.json`.

## Changes
- Bridge helpers propagate elevation/native-command failures and verify post-removal absence. Unknown, residual, wrong-target or partial firewall/portproxy state cannot report confirmed removal. Idempotent deletes skip only proven absence.
- Firewall readiness uses machine-readable rule properties, not localized console labels. Presence and readiness are separate observations; unknown status fails closed.
- Native start and bridge configuration reserve the UI, public FOH and internal FOH ports before mutation.
- The actual catalog serialization is bounded to98304bytes with a deterministic largest fitting track prefix, truthful total_tracks, unchanged command-ID validation and UTF-16-safe display limits. JSON bytes are never cut mid-document.
- `/v1/capabilities` defaults to the released client's play/pause/stop set. Exactly one `X-Swararia-Capabilities: extended-v1` header opts into all8features on this GET only; unsupported/duplicate headers retain the legacy response. Feature negotiation grants no permission.

## Verification
Full Python runner92/92, native-admin12/12 and both other Node harnesses pass. The companion FOH integration fixture preserves logical wildcard behavior but substitutes an actual127.0.0.1 bind; no LAN listener is opened by the tests. Initial4full-suite failures were stale test fixtures after machine-readable presence metadata was introduced; corrected fixtures now cover exact rule names, proven absence and unknown/residual failure states without relaxing production predicates.

The real Kotlin client-to-desktop HTTPS harness passes, including trust rejection before pairing, exact route-only opt-in, authorization, no ambiguous POST replay, deadlines and cancellation. An additional real TLS fixture plus actual released0610303 protocol decoder verifies legacy/unsupported negotiation; the current decoder accepts the actual97550-byte CJK/astral catalog with64groups and total250.

Android counterpart: commit `d19a86b7885c4e5f6761bfbf7ab6d26c7b3682a4`, source7 /0.5.1-spike on `fix/native-remote-review-0.5.1`. Its current24remote JUnit,13data JUnit,8SQLite/source,3wiring and1version tests pass. That source adds ordered application-owned persistence and catalog-error containment. Data/schema/appID/signing configuration and both applications' audio engines remain outside these fixes.

## Manual publication
No remote write is performed. After reviewing the commits, the user can push the desktop's existing feature branch and the Android fix branch separately, then create/update their respective PRs to main. Do not re-merge the old Android0.5feature branch to obtain0.5.1 fixes.

A push/merge does not update a running desktop app or installed phone. Source ZIPs are exact Git trees; patches apply only to their listed clean bases, not already updated trees. No dependency, SDK or certificate-store change is part of the delivery.

## Limits and recovery
This is a source release, not a Windows installer or new Android APK. No Gradle/KSP/full Android build was run; code-scanner16.1.0 remains uncached and no download was approved. Actual Windows PowerShell/UAC/firewall/WSL connectivity, physical Android Keystore/process death, scanner/Play Services, audio, rendering and installed-update behavior remain device gates. Ordered work survives coroutine-owner cancellation, not host process death or failed storage operations.

The22-file desktop preview and all pre-existing unmodified source files were byte-checked. Verified source bundles and staged/unstaged working snapshots are stored outside the repositories. For rollback, preserve newer work and revert only the relevant fix commit after approval; do not reset a whole tree, uninstall Android, clear app data or delete collections/designs.
