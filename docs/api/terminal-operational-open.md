# Native operational Open

The optional native-only request `{version:1,action:'open',profileId}` composes
start, attach output and enable keyboard input for one immutable reviewed profile.
The existing `start` request keeps its original behavior. Neither request is
exposed by the observer HTTP/WebSocket API.

`TerminalNativeBroker` presents exactly one explicit native confirmation with
`operation:'open'`, the executable/hash/version, exact argv (including the model
when selected), working directory, environment profile, permissions and policy.
Cancel is the native default. The confirmation covers all three named operations;
it is not an automatic approval of a separate request.

The supervisor still issues and consumes three independent one-shot challenges.
The broker signs each only after checking the enrolled document, native focus,
generation and that challenge's expiry. A blur, document loss or expired challenge
between asynchronous stages prevents further grants. Failure after launch retains
the process and attempt receipt, revokes/detaches this document's grants and never
retries, signals or adopts a process.

An admitted reply retains `instanceId` and the supervisor snapshot, with
`opening:'ready'|'incomplete'`. Incomplete means the renderer must show the remaining
output/input action for that same instance; it must not automatically start again.
No proof, attachment ID or keyboard lease crosses the renderer boundary.

Security review: no new observer endpoint, cookie, WebSocket or static-serving
policy. This is an additional operation inside the existing enrolled native broker;
exact profile authority and distinct start/attachment/input proofs remain required.
Synthetic broker tests cover success, cancellation/expiry and focus loss at every
asynchronous effect boundary. Real providers and native WebKit acceptance remain
separate and unvalidated by these tests.
