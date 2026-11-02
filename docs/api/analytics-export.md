# Aggregate Analytics export

## Implemented boundary

The **Most used models** screen offers explicit **Export CSV** and **Export Markdown**
gestures in browsers and a separate native save capability in supported Desktop clients. This is a local projection of the current aggregate response,
not a new endpoint, query, calculation of model attribution or background export.
The existing authenticated `GET /api/analytics/models`, worker, cookie, Host/Origin,
WebSocket and CSP contracts are unchanged. No dependencies were added.

Only a successful response associated with the current query, cursor and connection
generation can be exported. Refresh, changed filters/cursor, connection loss and
snapshot errors invalidate eligibility during render, before effects run. Recovery
requires a new response even with the same cursor. In-flight/late/failed responses
cannot export a previous report. The report records its response acquisition time,
not a new source measurement timestamp; it is a snapshot, not a promise of continuing
freshness. New source activity becomes visible through existing snapshot reconciliation.

The response body is streamed and actual bytes counted before concatenation, UTF-8
decoding or JSON parsing. The ceiling is **2,097,152 bytes**, independent of
Content-Length. Invalid UTF-8, MIME, JSON or summary shape fails closed. Structural
screen validation preserves the existing summary shape, without export-only bucket
or label limits. A legitimate report with long labels or more export buckets remains
visible. Its export controls are disabled with an explanation; nothing is truncated.

Strict export admission additionally requires **at most 5,000 model buckets**, IDs
of **1–256 UTF-16 code units**, valid Unicode text, nonnegative safe integers, unique
adapter/model buckets, unique gap reasons and consistent existing aggregate totals.
The serializer checks the response query against the query associated with that
reading. Final output is counted as UTF-8 including headers and line endings and
must be **at most 2,097,152 bytes**. It rejects the entire operation on failure;
no partial file, row omission, replacement zero or suppressed unidentified bucket.
All checks finish before creating the download Blob. Bounds do not guarantee a
hard latency or process-RSS ceiling.

## Projection and privacy limits

The fixed allowlist contains:

- Aggregate CLI adapter, observed model ID or explicit unidentified state, provider
  `null`, observed sessions and input/output/cached/total usage or explicit `null`.
- Selected aggregate totals, exact basis constants, all unavailable reasons,
  coverage scope/completeness/reason/counts and each gap reason/count.
- UTC half-open period bounds from that response's associated query, response
  acquisition time, displayed ranking, and filter markers `all`,
  `applied_value_omitted` or `unidentified_only`.

Workspace and agent IDs/names, raw query/filter values, session/machine/event/response
IDs, source references, evidence, messages, prompts, commands, paths and individual
contributions are not fields in the file. Unknown/additional fields fail strict
admission. Model filter values are not echoed as filter metadata; matching observed
model IDs can still occur in aggregate rows. A filtered report can reveal scope or
activity by its counts even when filter values are omitted.

**Observed model IDs are arbitrary, potentially private metadata.** A label could
itself contain a secret, path or identity. This implementation cannot prove absence
of secrets inside arbitrary labels, and escaping is not redaction. A visible warning
precedes both export gestures and travels with the report. Review model identifiers
and the selected scope before exporting/sharing. No complete privacy guarantee is
claimed. Filenames are fixed and contain no query, label, identifier or timestamp.

No new accounting is introduced. Usage/null and proven zero are preserved exactly;
provider remains unavailable. Coverage remains `complete=false` with its reason,
including an empty gap list explicitly counted as zero categories. Coverage is before
model filtering. Session rows are not additive, cache is a subset of input, and
comparison remains descriptive. Unbounded period bounds are explicitly `null`.
The export sorts a copy with the screen's shared token/session comparator and tie
breaks. It neither mutates input nor invents shares, costs, outcomes or attribution.

## File representation

Both formats use fixed English technical column names, independent of UI locale:

```text
section,field,value,adapter,model_state,model,provider,sessions,input,output,cached,total
```

One rectangular table contains metadata records (first three columns), one `totals`
record and the ordered `model` records. Blank fields mean not applicable, not zero.
`null` is explicit for unavailable usage/provider or unidentified model. A model row
with `model_state=unidentified, model=null` is distinct from
`model_state=observed, model=unknown`, or even an observed ID literally named `null`.
Totals' blank model fields are not a model bucket.

Text has a reversible visible ASCII representation. Only ASCII letters, digits,
space, period, underscore and hyphen remain literal. Every other Unicode code point
becomes `\u{hex}` with lowercase unpadded hex, e.g. newline `\u{a}`, pipe `\u{7c}`,
double quote `\u{22}`, NBSP `\u{a0}`, emoji `\u{1f600}`. Literal backslash is
`\u{5c}`. Thus an actual newline and the literal characters `\u{a}` never collide.
No control, invisible Unicode separator or bidi formatting character survives as
an invisible character. Original values are recoverable by decoding each escape
once, after removing the format's wrappers. Do not recursively decode escapes.

**CSV:** `orqst-model-usage.csv`, `text/csv;charset=utf-8`, comma delimiter, CRLF
including the final record, no BOM and no blank records. Every cell is double quoted;
embedded double quotes are doubled. **Every textual cell**, including headers,
metadata, booleans, blank and `null`, receives a leading apostrophe before its value.
This precedes leading spaces and any potential formula prefix. Dangerous punctuation,
tabs and line breaks inside labels are also encoded rather than creating formulas,
delimiters, multiline records or new cells. No formula-based text preservation is used.

Numeric cells up to 15 decimal digits use plain decimal digits, without grouping,
exponent or apostrophe. Larger safe integers use an explicit text cell, e.g.
`"'int:9007199254740991"`, preserving the digits against typical spreadsheet numeric
rounding. This typed marker differs from textual labels, whose colon is encoded,
and from literal `null` and numeric zero. A `csv_integer_encoding` metadata record
documents the rule. The CSV is for deliberate import/review; consumers can retain
apostrophes and the visible representation. Spreadsheet import settings, later
edits and reprocessing can change interpretation; universal safety across every
spreadsheet application is not claimed. Real Excel/LibreOffice import acceptance
has not been established by serializer/browser tests.

**Markdown:** `orqst-model-usage.md`, `text/markdown;charset=utf-8`, LF including the
final line, no BOM. One GFM table uses fixed structural delimiters. Textual cells use
fixed inline-code wrappers around the representation above; numeric cells use exact
decimal digits, including 16-digit safe integers. Backticks, pipes, angle brackets,
brackets, parentheses, colons, slashes and literal backslashes in dynamic text are
encoded. The report therefore introduces no dynamic HTML, Markdown links/images,
autolinks, code-span termination or additional rows/cells under CommonMark/GFM rules.
Code-span padding can affect visual edge spaces; the source representation remains
exact. External software that decodes/reprocesses content has its own trust boundary.

## Browser and Desktop authority

Browser downloads use a short-lived Blob URL and a fixed filename after validation.
There is no automatic upload, save confirmation, external-open action, server-side
file write or generic filesystem API. The browser controls destination selection,
cancellation and replacement behavior through its own settings; ORQST cannot
guarantee a save dialog or confirm successful disk persistence. The UI says so.

### Native Desktop contract

Supported clients expose only `window.orqstAnalytics.contractVersion = 1`,
`setReading(reading | null)` and `save(format, generation, reading)`. Older Desktop
clients retain the unavailable explanation and no export buttons. Downloads remain
denied in every Desktop client. Artifacts keeps its separate, unchanged
`orqstArtifacts` contract and `orqst:save-markdown` channel.

The single new channel, `orqst:analytics-export`, accepts strict version-1 objects:

- Context: `{ contractVersion: 1, action: "context", generation, reading }`.
- Save: `{ contractVersion: 1, action: "save", generation, reading, format }`.
- `reading` contains only `query`, `ranking`, `cursor`, `obtainedAt`, `readingId`
  (a new UUID for each acquired response) and a lowercase SHA-256 `digest`.
  Context may use `reading: null`; save requires a reading. Format is `csv` or
  `markdown`, ranking is `tokens` or `sessions`. Cursor and generation are safe
  integers; generation is positive and monotonically increases per document.
- Query admits only `from`, `to`, `workspaceId`, `agentId`, `adapter`, `model`.
  Instants are bounded to 64 characters, IDs/model filters to 200 characters,
  and the constructed URL query to 2048 characters. Null model becomes the
  existing `unidentified=true` HTTP parameter. No arbitrary parameter survives.
- Results contain only `status`: `acknowledged` (context), `saved`, `cancelled`,
  `failed`, `write_failed`, `stale`, `unavailable` or `busy`.

No text, content, path, URL, executable, source handle or open action is accepted.
The preload requires transient activation for save and holds a shared save gate
with Artifacts. Context updates bypass this gate so revocation works during a
pending dialog. Main independently validates sender identity, the expected live
window/webContents/session, attached main frame, same allowed origin/document URL,
and document generation. Navigation, close, destruction, crash and quit revoke
pending operations, including leaving and returning to the same URL.

The renderer publishes or invalidates context in a layout effect and waits for its
acknowledgment before enabling native controls. Filters, ranking, cursor, refresh,
errors, disconnect/reconnect (even at the same cursor), unmount and late responses
cannot reuse the preceding reading. Both preload and main reject old generations;
late acknowledgments cannot enable an obsolete reading. Save consumes context before
any asynchronous work. After every attempt the UI explains that Refresh and review
are required; there is no reusable grant, queue or automatic retry. One native file
operation is admitted at a time across Analytics and Artifacts.

Main reobtains data through the authenticated in-memory Electron session, with
redirects rejected and a **15,000 ms deadline per revalidation**, covering requests
and body reads. This exceeds the existing 10-second worker watchdog with finite
margin; event-loop scheduling is not a real-time guarantee. Each revalidation:

1. Reads the fixed route `/api/events?after=9007199254740991&limit=1`, admits at
   most 4096 body bytes, and requires exactly `{ events: [], cursor }` with a
   nonnegative safe integer cursor matching the confirmed reading. It never
   fetches `/api/snapshot` or requests source records for export.
2. Gets `/api/analytics/models` using only the validated query. Actual streamed
   bytes, JSON MIME, UTF-8 and strict export schema are checked before use.
3. Hashes the validated schema-ordered JSON with SHA-256 and compares it to the
   displayed response's digest. This includes query, contract/version, basis,
   aggregates and coverage. Query equality is also checked by the serializer.
4. Rechecks the same fixed cursor route. All authorization/context checks are
   repeated after asynchronous work.

A revalidation runs before the destination dialog, and a second runs after destination
and replacement confirmation, immediately before writing. These are sequential worker
queries, with no retries. Busy returns `busy`, unavailable/timeout/malformed data
returns `unavailable`, and a changed reading/cursor or revoked context returns `stale`.
None writes a report. A cancelled dialog returns `cancelled` without writing.
These checks are not a SQLite transaction spanning the dialog or filesystem write:
concurrent changes after the final check can still occur. The saved file represents
the matched reading, not an atomic or continuously current database snapshot.

The destination dialog identifies format, ranking, acquired time, period, aggregate
sessions/tokens and applied-filter markers without private filter values. The visible
model-metadata warning precedes the gesture and is repeated by the native dialog.
The same pure serializer in `apps/analytics-export.ts` generates both browser and
native bytes, preserving every allowlist, precision, privacy and encoding rule above.
Main checks the final 2 MiB output ceiling before granting any write.

Only the native dialog supplies a destination to main. Actual extension must match
exactly: `.csv` for CSV, `.md` for Markdown; other extensions are rejected without
renaming. The shared native destination policy keeps Artifacts at `.md`/32 KiB and
Analytics at its selected extension/2 MiB. It rejects symlink, hardlink, directory,
executable, large or ambiguous targets, checks canonical parent and descriptor/path
identity and bytes, and creates new files with `O_EXCL | O_NOFOLLOW`/0600. Existing
files require a separate warning naming the concrete canonical target with Cancel
default. There is no generic filesystem permission or automatic open action.

Writes remain in place, not atomic or crash-recoverable. `write_failed` means the
destination was touched and may contain partial/changed data; no automatic rollback
or retry is claimed. Noncooperating same-user processes can race the final checks.
Paths, query identities, payloads and native error diagnostics are never returned or
logged by this capability. No change grants source-file or agent-process authority.

## Security review note

The native increment adds a dedicated narrow IPC and main-process destination grant.
It reuses existing authenticated GET routes without changing API/worker/accounting,
cookies, Host/Origin, WebSocket, static serving, CSP, database or source access.
Strict DTOs, sender/document generation checks, live revocation, consumed context,
matched bounded refetches and native destination/replacement dialogs constrain that
authority. Artifacts remains separate and shares only the safe destination policy
and one-operation gate. No shell/open capability is added. Privacy, final-check
concurrency, in-place-write and external reprocessing limits remain explicit.

Synthetic automated/browser tests and a disposable Electron smoke can validate
mechanisms and writes with intercepted dialogs. They do not establish native dialog
visual acceptance, real spreadsheet import, signed distribution or real-provider
multi-model completeness; validation outcomes must be reported separately.
