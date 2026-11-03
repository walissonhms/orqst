# Structured managed agents in Desktop

The checkout Desktop now composes the existing signed Codex structured runtime and
pane communication into its **Managed agents** button and native Managed Terminal
menu. This supersedes earlier statements that the structured runtime has no client
surface. The browser dashboard and observer Bridge remain read-only; no control
REST/WebSocket endpoint or observation-cookie authority was added.

## Preparation and use

Use Node 24 and pnpm 10. Provision two **new private directories outside the
project**, following [existing CLI integration](local-cli-integration.md):

```bash
pnpm terminal:setup --authentication reuse-existing \
  --acknowledge-shared-native-config \
  --executable /absolute/canonical/codex --executable-version EXACT_VERSION \
  --project /absolute/canonical/project --state /absolute/new-state-a
pnpm terminal:setup --authentication reuse-existing \
  --acknowledge-shared-native-config \
  --executable /absolute/canonical/codex --executable-version EXACT_VERSION \
  --project /absolute/canonical/project --state /absolute/new-state-b
pnpm build
pnpm desktop
```

Setup never executes the provider or reads credentials. Select the admitted native
binary/version from your own offline compatibility evidence, not an inferred model
catalog. No automatic login, provider detection command or inference runs on opening
the client or view.

1. Open **Managed agents** in Desktop. Enter the exact model identifier for each
   terminal. Installed/native login does not establish model entitlement.
2. Click **Start new Codex**. The first click asks for both private `terminal.json`
   manifests; their native selection order assigns A then B. The confirmation shows
   the complete selected executable, hashes, paths, model, identity and policy.
   Review these paths before signing. Each terminal requires its own confirmation.
3. Observe actual startup phase, lifecycle, immutable instance/pane identities,
   workspace-scoped `T-NNN` identity, new native thread and confirmed model. Failed
   startup or lost ownership cannot be retried/adopted. An unsigned preparation can
   be reviewed again; expired challenges are not signed.
4. Once both panes report ready, enter instructions for A and the exact B task.
   Review the full generated root prompt, fixed target, task, correlation and
   deadline in the separate native confirmation. A receives one scoped
   `orqst_delegate_task` operation; B receives no delegation grant. There is no
   planner, recursive delegation or PTY input injection.
   Complete native review is capped at 4096 characters, so use short instructions
   and tasks; oversized plans/manifests are refused rather than truncated.
5. The view stays responsive while the root runs. B's verified result appears in
   B; the correlated root result appears in A only after native tool return evidence
   and root completion. Queue admission, acceptance, delivery and completion stay
   separate. Missing receipt/ownership becomes unknown, never a successful result.
6. **Stop owned process** requires separate native confirmation and sends SIGTERM
   only through the current owned handle. It does not prove process exit or
   descendant cleanup. No stored PID is used for signaling.

These are structured task terminals with inert text/evidence, not interactive PTY
emulators. The existing separate-login xterm path remains available independently
through `--terminal-config`; reuse manifests cannot enter that legacy path.

## Boundaries and limits

- The selected native HOME/CODEX_HOME remain shared. The CLI alone checks native
  account availability with `refreshToken:false`; ORQST discards identity/plan data.
  Native startup may refresh credentials or launch configured MCP servers. ORQST
  does not promise shared config/auth/cache immutability or hard containment.
- Read-only/on-request are native startup defaults. Prompt prohibitions on tools
  are advisory, not a filesystem/network sandbox. No provider approval UI is
  exposed. Same-user trust and configured MCP access remain material risks.
- Two active instances, at most sixteen root submissions per view, one exact
  delegation per root and a 120-second task deadline. Root/native and worker byte
  budgets remain in Core. No enforced token, spend, CPU or descendant budget exists;
  native confirmation explicitly discloses advisory cost limits.
- Only selected new private slot databases are created. Existing
  `terminal.sqlite`/`desktop-communication.sqlite` cause rejection before Store is
  opened. No observer database or existing journal is migrated. Queue/audit store
  metadata only; prompts and results have bounded, exact-scope memory storage.
- A private `managed-agents/active-pair.json` admission marker in Desktop user data
  is flushed before launch. Another client lifetime cannot bypass unresolved work
  by selecting fresh manifests. It has no TTL or PID takeover and is released only
  after native-confirmed exits and known task outcomes are observed. A stale marker
  requires separate evidence-backed reconciliation; the client has no reset button.
- Closing hides the same live view. Reopening it does not launch another process.
  Reload, navigation, renderer loss and application quit disconnect without an
  implicit signal, preserve uncertainty and cannot adopt/retry work. Provider hosts
  retain the existing 30-minute TERM/KILL lifetime policy. Dirty journals require
  separate evidence-backed reconciliation; do not delete them to bypass capacity.
- The dedicated document has a separate memory-only session, sandboxed preload,
  no Node integration, no network, no navigation/download/window permissions, and
  strict bounded IPC. Only native file selection supplies manifests. Renderer
  fields cannot select paths, proofs, epochs, target IDs, grants or approvals.
  Native focus/document identity are checked before and after confirmation; the
  native signer never exposes a signing API. Output uses `textContent`, escaping
  terminal/format controls; captured content never executes as HTML.

## Validation and real blockers

Synthetic integration tests cover separate signatures, canceled preparations,
distinct identities/threads, the complete A-to-B-to-A return, result correlation,
acceptance without invented delivery, exact public schemas, source loss and refusal
to reopen existing journals. The explicit Electron smoke opens the shipped view and
checks isolation/empty controls without selecting manifests or launching a provider.
Fixtures do not prove installed CLI login, model access, native modal acceptance or
real delegation. No provider execution is part of tests, build or normal startup.

The historical real startup failure and real two-agent acceptance remain unresolved.
This delivery wires the usable client path; it does not claim the two-real-agent
milestone has been accepted. `history_changed` in the shared source guard remains
**inconclusive**, as fixed in dffa1e6; no passing preservation claim is inferred from
this UI, from fixtures or from absence of visible errors. See
[real acceptance and preservation evidence](codex-two-agent-acceptance.md).
