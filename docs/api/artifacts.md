# Manual Artifacts

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

Every view indicates whether the draft exactly matches the retained original, including
whitespace. This comparison is independent of copying or saving; it never verifies a
saved file or source completeness. **Restore draft from original** is available only
when the text differs. It first asks for confirmation, focuses Cancel and permits
Escape cancellation without losing edits. Confirming replaces only the memory draft
with the already loaded retained text, clears draft copy/save feedback and edit errors,
and returns focus to Edit draft. It does not reextract content, alter provenance,
update the retained original or touch saved files. Draft editing, view changes and
native saving are disabled during confirmation; restoration is disabled during a
native save. Closing or leaving the panel retains the existing discard behavior.

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

Desktop now exposes the narrow save action below. Browser clients have no native
save/export/open buttons and explain that Desktop is required. Clipboard remains an
independent browser permission; this increment does not enable it on Desktop.

## Security review note

This route adds explicit access to a bounded retained assistant/agent body already
covered by local observation authentication. It grants no native source-file authority
or agent control. The trusted-local-user/listener limitation is unchanged; metadata
and redacted text can remain sensitive. UI drafts are not sent back to the Bridge.
CSP, cookies, loopback binding, source read-only protections and the single Store writer
are unchanged. Existing v1 REST/WS payloads and lifecycle reference semantics remain
compatible. See [security model](../architecture/security-model.md).

## Native Desktop save contract

This is a Desktop-only `window.orqstArtifacts` capability, not a REST endpoint.
`contractVersion: 1` exposes only `saveMarkdown(request)`. The strict discriminated
request is either:

```ts
{
  contractVersion: 1,
  selection: ArtifactExtractionRequest,
  representation: 'original',
  openAfterSave: boolean,
}
// or
{
  contractVersion: 1,
  selection: ArtifactExtractionRequest,
  representation: 'draft',
  draft: string, // <=32768 UTF-8 bytes; empty allowed; no NUL/unpaired surrogates
  openAfterSave: boolean,
}
```

`original` forbids a draft/content field. Unknown fields, versions, paths, URLs,
executables, file handles and grants are rejected. Main reextracts retained original
through the fixed authenticated endpoint and checks the entire response contract,
event ID/sequence, native session/machine/adapter, recorded workspace/agent and source
hash against the validated selection. Unavailable/expired/mismatched evidence denies
both representations. No source path is opened. The retained original remains exactly
the retained/redacted representation with completeness unverified; draft edits have no
new provenance or document-version claim. Files contain only the selected text.

A dedicated **Save original/draft** or **Save original/draft and open** button is required.
Sandbox/context isolation remain enabled and Node integration remains off. The isolated
preload checks transient user activation; main does not treat that check as authority.
Main validates the exact live window/webContents/session/main frame and fixed root
origin/document, then requires a native save dialog to grant the destination. Navigation,
crash, close and quit revoke in-flight authority even when the same URL returns. One
operation is admitted at a time; no queue or reusable grant is returned or persisted.

Only an absolute `.md` destination from the native chooser is accepted. Main canonicalizes
its parent and keeps its identity. No directories are created. Existing targets must be
regular nonexecutable single-link files no larger than 32768 bytes. Symlinks, hardlinks,
nonregular targets, oversized/ambiguous destinations and observed target/parent changes
are refused. The writer does not resolve macOS alias contents or follow them as paths.
For a new file, `O_CREAT|O_EXCL|O_NOFOLLOW` and mode `0600` prevent silent replacement.
An existing destination is opened with `O_NOFOLLOW` and without `O_TRUNC`; a native
warning shows its exact canonical path with Cancel selected by default. After explicit
replacement confirmation, main checks the same descriptor against path/parent identity,
mode/link count, size, nanosecond modification/change times and bounded original bytes.
It writes only that descriptor, truncates it only after all new bytes have been written,
flushes and verifies the saved descriptor/path/content. It never unlinks or blindly
renames over a target. Existing permissions are preserved; executable targets are denied.

Results contain only `{ status }`, with no text, paths or OS diagnostics:

| Status              | Meaning                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `saved`             | Markdown written, flushed and verified; no open requested.                                                                    |
| `saved_opened`      | Saved and `openPath` accepted by the system; editor/window display is unverified.                                             |
| `saved_open_failed` | Save succeeded; optional opening failed or could not be confirmed. No retry.                                                  |
| `cancelled`         | Destination or overwrite cancelled; no file created/modified.                                                                 |
| `failed`            | Rejected before writing, including invalid/stale input, changed destination or unsupported target.                            |
| `write_failed`      | Creation/write/flush/verification failed after effects became possible; file may exist or be partially changed. Never opened. |

Opening is part of the same explicit **Save and open** gesture. Immediately before
`openPath`, main rechecks the newly saved descriptor, parent/path identity and exact
bytes. The only argument is this operation's internal saved path; there is no open-only
API, historical path, URL, renderer grant or chosen executable. The OS default Markdown
application is used. This handoff is not proof of an external editor opening.

### Race, failure and validation limits

Descriptor identity protects against following a swapped symlink or truncating a newly
substituted destination. Observed content/metadata/parent changes fail closed. These
checks do **not** provide an atomic compare-and-swap of filesystem names, protection
against a noncooperating same-user process modifying a file between checks/system
handoff, atomic saves or guaranteed crash recovery. Overwrite is in place; I/O failure
or a crash can leave partial content. No automatic rollback risks overwriting a later
writer. A successful flush is not a general durability guarantee. These limits follow
the existing trusted-single-user model and are surfaced honestly through results.

Synthetic Node tests exercise cancel/save/overwrite, strict DTO/UTF-8/hostile content,
link/target/parent races, bounded verification, revocation, concurrency, replay and
sender/frame checks. Disposable real Electron checks run the actual isolated preload,
main IPC, authenticated extraction and file writer; dialog responses and external open
are intercepted only in that temporary test process. Native dialog visuals, real editor
launch, other platforms and adversarial OS races remain unvalidated. Existing session
files, Store/schema, Bridge/service and owner Desktop process are unchanged.
