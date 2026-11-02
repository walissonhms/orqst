# Manual Artifacts — first slice

In a session's **Execution timeline**, choose **Extract artifact manually** on one retained
Codex assistant/agent message. The separate panel stays within the session flow;
it does not launch or modify an agent. Selection is explicit for every message,
including ambiguous content. No automatic Markdown recognition is implemented.
The event's recorded workspace/agent identities remain authoritative provenance,
even if the session has since been manually associated with another workspace.

## Read-only extraction contract

`POST /api/artifacts/extract` is a read-only query using the existing same-origin
HttpOnly/Strict cookie and Host/Origin/fetch-metadata checks. It requires JSON,
rejects query parameters and uses the existing 8192-byte request-body ceiling.
The strict request has exactly these fields:

```ts
{
  contractVersion: 1,
  sequence: number, // positive safe integer
  eventId: string,
  sessionId: string,
  machineId: string,
  adapter: 'codex' | 'claude' | 'opencode' | 'manual',
  workspaceId: string,
  agentId: string,
  sourceHash: string, // lowercase SHA-256 of the source record
}
```

Identities use the existing lifecycle limits (nonblank, no controls, at most 1024
characters). Unknown keys, invalid identities/sequences and unsupported versions
are rejected before lookup. Only numeric literal version 1 is supported. There is
no fallback version. Invalid requests return sanitized `400` errors; missing
cookie returns `401`, untrusted origin/host returns `403`. All replies are `no-store`.

`ObserverCore.extractArtifact(request)` reads at most one exact retained event
through the existing Store, validates the v1 envelope and compares every supplied
identity and source hash. The same event supplies both reference and body in one
synchronous operation. No second lookup, directory scan, source dereference,
summary/metric fallback, migration or new writer exists.

The strict `orqst.artifacts` version-1 result discriminates on `availability`:

- `available`: `value` contains `contract`, `contractVersion: 1`,
  `selection: 'manual_message'`, `eventSchemaVersion: 1`, `reference` (the existing
  complete `artifactReference`), and `original: { text, representation:
'retained_redacted_text', completeness: 'not_verified' }`.
- `unavailable`: only `reason`, one of `event_not_retained`, `identity_mismatch`,
  `unsupported_adapter`, `not_artifact_message`, `content_limit`.

The original `artifactReference` contract is unchanged, including its
`content: { availability: 'unavailable', reason: 'reference_only' }`. The new text
is a separate allowlisted field. Only its existing source-backed role/record rules
qualify, never user/tool/status/summary content. Unsupported adapters stay unavailable.
Malformed retained evidence fails closed with a sanitized error and no payload/path.

Extraction admits at most **32768 bytes (32 KiB) of UTF-8 retained text** and never
truncates. This is a new extraction limit, distinct from ingestion's existing
32000-character redaction/capture limit. Retained text can already be redacted or
truncated; “original” means the unchanged retained representation, **not a verified
complete provider response**. The source hash versions a source record, not a saved
document or draft revision. Existing identity/source metadata only is returned;
no cwd, absolute path, tool payload or extra label is added. Source verification
remains `not_rechecked`; missing observation/worker identity remains unavailable.

## Panel, preview and clipboard

The panel exposes recorded project/session/agent/machine, adapter/role, event date,
event ID/sequence, contract/event versions and source record provenance as inert text.
**Original source** never changes. **Draft preview** and **Edit draft** use a separate
32-KiB UTF-8 memory-only draft initialized from that original. Oversized edits are
rejected with a visible error. Closing the panel, switching sessions or reloading
discards the draft. No artifact persistence, draft history or document versions exist.
Close the current panel before extracting another message.

The React preview supports only heading lines, bullet lists and fenced code blocks.
Other syntax, including inline Markdown, HTML, links, images and URLs, stays literal.
No `innerHTML`, HTML parser, active anchors/media, remote loads, execution, navigation,
webview, privileged renderer or additional dependency is introduced. This is a limited
preview, not CommonMark compliance. Readable text follows these same block rules and
keeps unsupported syntax literal. Original and draft raw Markdown remain copyable.

Each clipboard write requires a dedicated button gesture. Success appears only when
`navigator.clipboard.writeText` resolves; unavailable/denied writes show failure.
Electron retains its permission-denial policy, so copying may be unavailable there;
no privileged IPC or permission exception is added to bypass it.

**Pending next slice after file-contract review:** save `.md` with a native destination
grant, explicit overwrite confirmation, and external editor integration. There are no
placeholder controls, filesystem/shell APIs, arbitrary source-file reads or hidden saves.

## Security review note

This route adds explicit access to a bounded retained assistant/agent body already
covered by local observation authentication. It grants no native source-file authority
or agent control. The trusted-local-user/listener limitation is unchanged; metadata
and redacted text can remain sensitive. UI drafts are not sent back to the Bridge.
CSP, cookies, loopback binding, source read-only protections and the single Store writer
are unchanged. Existing v1 REST/WS payloads and lifecycle reference semantics remain
compatible. See [security model](../architecture/security-model.md).
