# Two-agent native delegation: reviewable acceptance

**Implemented:** an opt-in app-server dynamic function, two independently identified
Core panes, a separately signed root request, exact A-to-B delegation, durable
communication and native tool-result return into A. Tests use synthetic transports;
no installed provider, credential, login or paid inference has run for this change.
The explicit developer command below is prepared, **not executed**. It is outside
normal Desktop, observer, CI and automatic test startup. This is a headless native
Core acceptance, not an interactive Studio/xterm visual acceptance.

## Minimal authorization and capability contract

Start A with `dynamicTools:true` in its signed start manifest; B uses false.
The adapter opts into the documented experimental API and declares only
`orqst_delegate_task`. Initialization has no documented server capability echo for
this field, so the runtime reports **requested**, never verified support merely
because initialization succeeded. Only a valid native item/tool/call for this exact
function, thread and turn makes support **observed**. Rejected initialization/fields,
unknown formats or a model that never calls the function fail the acceptance without
silently substituting a provider, model, protocol or PTY path.

`prepareRootTask` produces a separate reviewable plan/challenge binding source and
target identities, exact root prompt, exact delegated task, correlation, deadline
and one-call budget. At most 128 root preparations are retained per runtime owner;
there is no root retention/reclamation API or automatic retry. `runRootTask` consumes a distinct signed input proof before any
root inference or communication grant. Returned plans are copies; editing one cannot
change the consumed grant. Root work is an explicitly authorized native user turn,
not a fabricated third pane or a self-addressed communication message. Its in-memory
result cannot be resumed after owner loss. The A-to-B message itself is durable.

The native tool takes exactly `{targetPaneId,task}`. Both must match the approved
plan byte-for-byte, within the same workspace and owned bindings. Agents cannot
supply grants, select another actor, change budgets, expand task text, choose another
workspace or delegate recursively. At most one native tool call is allowed per root;
B receives no delegation grant. The existing SQLite queue, hash/scope resolver,
idempotency, capability and uncertainty rules still apply. Busy queued work dispatches
on verified readiness, without PTY typing, provider interruption or polling.

A's RPC waits for a verified B completion and exact-scope result hash, rather than
returning success at admission/acceptance. The response contains separate message,
task and correlation metadata plus explicitly untrusted worker text. The serialized
response is capped at 16 KiB as well as the worker's 8 KiB raw limit; excess returns
a bounded tool failure rather than losing the instance. Root results also validate
their exact local scope/hash before returning to the native client. A must then
emit the matching dynamicToolCall item completion with success before the root
result qualifies. Missing receipt, wrong thread/turn/call, lost transport, expired
grant, denied target/task or unknown work never passes A-to-B-to-A acceptance.
This is a bounded response task, not independent validation of repository artifacts
or a user's broader goal. There is no generic RPC responder, shell tool, provider
approval decision, MCP install, planner or new network listener.

Reference semantics were inspected independently from official documentation and
OpenAI's protocol declarations at commit
`dbaead0106de82bd129a4f6f503d173ad5109f68`: DynamicToolSpec,
DynamicToolFunctionSpec, DynamicToolCallParams and DynamicToolCallResponse under
`codex-rs/app-server-protocol/schema/typescript/v2/`. No generated source/schema is
copied into ORQST. The local validators intentionally accept only the narrow subset
needed here: namespace:null, object-valued arguments, item/tool/call and a
dynamicToolCall completion whose id matches callId and whose status/success confirms
receipt. These shapes are unvalidated against the installed app-server and are
compatibility assumptions, not advertised universal capabilities. A different shape
fails closed. This source evidence is not compatibility validation of an installed
binary. See [official app-server documentation](https://developers.openai.com/codex/app-server/).

## Proposed real run and cost allowance

The owner must first approve the exact native binary path/hash/version, model and
operations below. Use a dedicated **empty project**, not this repository or user
data. Proposed model: `gpt-6.1-sol` only if the admitted CLI/account confirms that
exact identifier. Otherwise stop and ask; never fall back. Device logins must be
performed separately by the owner in two newly provisioned homes; ORQST does not
read/import existing credential content or use a keyring/shared Codex home.

The run has two native turn/start submissions: root A and worker B. A's turn includes
one tool continuation. Both prompts prohibit file reading, commands, modifications,
permission requests and tools other than A's one exact delegation. Root duration is
120 seconds, maximum one delegation, request 2 KiB, worker result at most 8 KiB.
The fixed process lifetime remains 30 minutes if control is lost; confirmed cleanup
normally stops the two owned processes immediately after the run.

For planning, an assumed aggregate **15,000 input + 2,000 output tokens** at the
published GPT-6.1 Sol Standard API-equivalent rates of $2/$10 per million is about
**$0.05**. Proposed owner spending allowance: **$0.25**. This is an estimate and
permission ceiling, **not an enforced provider billing cap**: harness/reasoning usage
can differ, and device login may consume subscription quota rather than API dollars.
No token/cost measurement or hard dollar limit is currently implemented. The
explicit command therefore requires acknowledgement of advisory-only cost bounds.
If a hard cap is required, configure a provider-side budget independently or postpone
the run; do not claim that a timeout caps charges. Rates were reviewed 2026-11-03 in
the [official model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol).
Recheck model/account/pricing at approval time. No rate is represented as actual billing.

## Steps, all pending owner authorization

Use Node 24/pnpm 10. Replace the three owner-reviewed values; do not paste credentials.
The root below must not exist. Do not recreate state to bypass unresolved earlier
process/task ownership. No installed service or current Desktop needs a restart.

```bash
ORQST_ACCEPT_ROOT=/private/tmp/orqst-two-agent-accept-20261103
ORQST_CODEX_NATIVE=/absolute/owner-reviewed/native/codex
ORQST_CODEX_VERSION=OWNER_REVIEWED_VERSION
mkdir -m 700 "$ORQST_ACCEPT_ROOT"
mkdir -m 700 "$ORQST_ACCEPT_ROOT/project"
pnpm terminal:setup --executable "$ORQST_CODEX_NATIVE" \
  --executable-version "$ORQST_CODEX_VERSION" \
  --project "$ORQST_ACCEPT_ROOT/project" --state "$ORQST_ACCEPT_ROOT/slot-a"
pnpm terminal:setup --executable "$ORQST_CODEX_NATIVE" \
  --executable-version "$ORQST_CODEX_VERSION" \
  --project "$ORQST_ACCEPT_ROOT/project" --state "$ORQST_ACCEPT_ROOT/slot-b"
pnpm build
```

Provisioning itself executes no provider. After specific login authorization, the
owner runs each fixed device login independently, then completes the browser login
personally. The selected native binary must be compatible with these flags.

```bash
for ORQST_ACCEPT_SLOT in slot-a slot-b; do
  env -i HOME="$ORQST_ACCEPT_ROOT/$ORQST_ACCEPT_SLOT/home" \
    CODEX_HOME="$ORQST_ACCEPT_ROOT/$ORQST_ACCEPT_SLOT/codex" \
    TMPDIR="$ORQST_ACCEPT_ROOT/$ORQST_ACCEPT_SLOT/tmp" \
    PATH=/usr/bin:/bin:/usr/sbin:/sbin LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 \
    "$ORQST_CODEX_NATIVE" -c 'cli_auth_credentials_store="file"' login --device-auth
done
```

Review the two configs, identities/permissions and the exact acceptance script.
Only after owner approval of provider inference, the advisory $0.25 allowance and
owned-process cleanup, invoke:

```bash
pnpm exec tsx scripts/accept-codex-two-agent.ts \
  --authorize-real-codex --acknowledge-advisory-cost-only \
  --cleanup-owned-processes --acceptance-root "$ORQST_ACCEPT_ROOT" \
  --model gpt-6.1-sol
```

Missing flags fail before config/filesystem/credential access or a provider launch.
The script insists on these two slot paths and the empty project, and rejects any
previous runtime/communication journal. It prints only newly created pane/native
metadata, correlation/result hash, actual metrics as unavailable, and cleanup status;
no auth material, prompts, captured histories or raw native output are printed.

B's task is to return a fresh disposable marker without reading files or running
commands. A must call the function with the exact target/task and return that marker
only after B's native result. Acceptance requires correlated native start/completion,
B result hash/scope, A's dynamic-tool receipt and A's matching final marker. A missing
capability/call/receipt or any uncertain result fails; no synthetic fallback is used.

## Cleanup and evidence

The cleanup flag authorizes TERM to each still-owned handle, followed by a distinct
signed KILL after two seconds if needed. Each wait is bounded. No PID is adopted or
signaled after ownership loss. Signal-only exit is recorded honestly in the live
snapshot; the journal may still reserve lost capacity because its older exit schema
requires a numeric code. A lost process remains uncertain and retains its disclosed
host lifetime; inspect/reconcile before retrying or deleting state.

The script retains private state and new credentials (`0700` directories/`0600`
files) so failures are reviewable. Once **both owned exits are confirmed**, the owner
may revoke the two device authorizations through the provider and explicitly remove
only this new acceptance root. Never remove the user's normal Codex home, source
sessions, installed ORQST database or service. Do not delete uncertain journals to
recover capacity. No state/root deletion or provider logout is automated here.

Record CLI/Node/OS versions, two pane IDs/native thread IDs, exact selected/reported
model, task/correlation/hash and both cleanup results locally. Do not commit this
local evidence, homes, authentication, histories, database or generated output.
Passing this command would validate the headless native path on that specific
binary/account/OS; it would not validate interactive Desktop panes or the full MVP.
