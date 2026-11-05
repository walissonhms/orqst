# Single CLI authorization: integration and verification

See the [private API and security contract](../api/single-cli-authorization.md).
This is source implementation with synthetic acceptance, not native/provider acceptance.

The backend installs one durable CLI policy in the existing Tauri terminal host. The
first focused `open` may review the local CLI once and then performs the existing
launch/attach/input sequence. Further opens and model choices reuse its scope. Existing
short-lived input leases renew silently only under current native focus/document and
the same policy epoch. No provider approval defaults change.

Integration checklist for the coordinated native/frontend increment:

- [x] Private policy authorize/current/epoch port and strict durable record.
- [x] Optional public refusal `authorization: blocked | revoked`; no private capability exposed.
- [x] Stable scopes in Codex, OpenCode and Claude profile factories; missing scope blocked.
- [x] Existing fresh Core proofs and native current/focus/generation fences retained.
- [x] Input suspend/resume/renewal with continuous renderer sequence and uncertainty fence.
- [x] Plain bounded paste and explicit owned Stop without another application review.
- [x] Owned retirement evidence port; revoked CLI-use trust does not prevent release.
- [x] Invalid retirement evidence denies inline without fallback to legacy confirm.
- [ ] Integrate frontend focus resume/suspended state and the single main-window mount.
- [ ] Include locale keys `terminalNative.authorizeCli` and `terminalNative.cliScope`
      from frontend commit `95730cc67e070ba99d22cee71595fd9188ea6535`.
- [ ] Coordinate native Quit/window-close shutdown using real Core exit receipts.
- [ ] Independent security review of the combined native/frontend/backend diff.
- [ ] Separately authorized native focus/consent/provider acceptance and packaging.

No Cargo, build, resource staging, native interaction, provider execution or real
AppData/session access is needed for these backend source checks. The open Preview
application and its executable/resources must remain intact. Legacy hosts without
`cliAuthorization` retain the prior confirmation behavior; this increment does not
claim that Electron or every native lifecycle path has migrated.
