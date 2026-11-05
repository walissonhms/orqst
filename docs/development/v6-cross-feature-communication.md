# Cross-Feature communication: synthetic Core increment

This increment defines an opt-in Core/protocol/SQLite path for one `task.request`
between two Features in the same Workspace. It has no production authority port,
endpoint, dashboard wiring, production adapter, or native confirmation. The injected
ports in tests are explicitly SYNTHETIC. It must not be used as production authority.
Existing local and unscoped communication continue through their existing path.

Each Feature has a separate versioned cross-Feature policy. The source must contain
an exact outbound rule and the target an exact inbound rule for the same operation
and exact local/remote Feature and terminal IDs. Missing policies deny. View is a
separate bilateral operation. No wildcard, name, handle, or role grants permission.
A grant binds the actor, workspace, both Features, terminals, panes and bindings,
operation, intent digest and ID, nonce, deadline, and both policy revisions. A
trusted port must validate the entire grant and proof. Request data is represented
by a bounded opaque content reference and digest, not captured text in the audit.

## Decision ordering and persistence

The lock order is journal then preferences. A journal transaction takes
`BEGIN IMMEDIATE`, and the Core reads both policies, revisions, Feature states and
memberships in one preferences transaction before its decision. **The decision
linearizes at that single preferences snapshot**, conditional on successful journal
commit. A policy write committed before the snapshot is seen; one committed after
it is ordered after that decision. Before any subsequent claim the snapshot and
both revisions are checked again. A revocation leaves the message queued and does
not retarget or retry it. This is not a distributed SQLite transaction.

On admission, SQLite uniqueness constraints consume the grant, intent, nonce and
idempotency identity in the same journal transaction that inserts the message and
versioned administrative audit. An audit or insert failure rolls back all three.
The journal commit is the durability boundary. A process exit before it leaves no
admission; after it the journal retains the admission even if in-memory grant
state disappears. A fresh service does not restore a grant. Recovery marks a
previously claimed message `outcome_unknown`; it does not retry it.

Both Stores configure `busy_timeout=5000` milliseconds. A failed snapshot/lock
acquisition denies the operation; there is no automatic retry. Existing readers
of local policies already acquire journal before preferences. The policy and
Feature writers below only take preferences and do not acquire the journal:

- `featureConfigurationDatabase.savePermissions` → `Store.featurePermissions().save`;
- `featureConfigurationDatabase.saveCrossFeaturePermissions` → `Store.crossFeaturePermissions().save`;
- `featureConfigurationDatabase.create`, `update`, and `assignTerminal` → `Store.features()`;
- `terminal/host.ts` routes `featureCreate`, `featureUpdate`, and `featureAssign` to those Feature writers.

The database methods use the Store transaction and its `BEGIN IMMEDIATE` on the
preferences file. No communication journal is acquired by those writers. This
claim concerns the inspected Core paths; it does not establish behavior of
untrusted direct file modification.

Existing local `authorize` loops over multiple target panes and reads its policy
separately for each target; it compares revisions between those reads. The event
filter likewise evaluates multiple recipients separately. These pre-existing local
paths are unchanged and do not constitute one shared multi-recipient snapshot.

## Limits

The journal remains additive: historical v1 messages are not rewritten. There is
no production route, native signer, native picker, interactive MCP, real provider
submission or native UI acceptance in this increment. A claimed
cross-Feature message is only a Core journal state, not provider acceptance or
completion. Synthetic tests cannot prove the behavior of a future native signer
or UI. Cross-Workspace is denied by the exact workspace and Feature membership
checks; a policy cannot grant filesystem, terminal input, or CLI authority.

The communication journal creates cross tables only on explicit Core opt-in.
Local admission checks the stable indexed cross identity columns without parsing
cross message metadata, so a future cross schema version or invalid metadata does
not by itself block local communication. A structurally damaged identity table
cannot establish uniqueness and still fails closed. Cross recovery is deferred
until opt-in and remains fenced by the communication owner epoch.

A trusted host may configure a cross route only with a verified grant and its
exact request digest, managed pane bindings, and current same-Workspace Feature
membership. The route is stored separately from the local routing matrix. It
is not a grant: admission still rechecks both policies and the one-use proof.

A compact cross usage ledger is updated in the same journal transaction as each
admission and claim. Local and cross admission share the history, per-target queue,
and per-actor rate limits; both dispatch paths count active and uncertain work in
the same target and global capacity. Local accounting reads this ledger without
parsing cross message content. A failed ledger write rolls back cross admission.

## Structured dispatch and observation

An injected trusted adapter may submit only after content digest verification and
a fresh bilateral claim. Its correlated evidence must match message, task, correlation, pane,
attempt, instance and terminal epoch. Acceptance, delivery, execution and outcome
are persisted only when reported; missing or invalid receipt, timeout and transport
failure leave `outcome_unknown` without automatic retry. Provider facts already
received remain recordable after policy revocation. Notifications are post-commit
and revalidate bilateral view and authority inside the microtask. Parent tasks use
exact IDs and correlation, verify the active destination as the next source, and
apply the existing maximum depth and cycle checks. A local child of a cross task
requires an explicitly injected trusted ancestor gate, which rechecks bilateral
view and retained authority; the existing production composition does not install it.
For an admission with parent tasks, all relevant local and cross policies are read
inside one synchronous preferences transaction under the journal transaction.
Without that snapshot gate, parent-linked admission fails closed. A multiprocess
SQLite probe confirms a competing writer cannot acquire the preferences write
lock until the snapshot decision ends.

A separate versioned administrative audit records a verified grant presented for
admission, a denial attributed to a verified grant, and an explicit revocation.
Malformed or unverified proofs cannot establish an actor and do not create a
purported actor audit. Administrative and message events contain IDs and states,
not prompts, responses, paths, tokens or arbitrary errors. These ports remain
unwired in production; synthetic adapters and two direct concurrent SQLite writers
exercise the local contracts and uniqueness, not a real provider or native signer.
