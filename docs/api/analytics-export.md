# Browser aggregate Analytics export

## Implemented boundary

The **Most used models** screen offers explicit **Export CSV** and **Export Markdown**
gestures in browsers. This is a local projection of the current aggregate response,
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

**Desktop Analytics saving is pending.** Electron still denies downloads; it shows
an explanation with no Analytics export button or download anchor. The Desktop
User-Agent marker also identifies older clients without an Artifacts preload;
this is a UX choice, not an authorization check. The existing
Artifacts Markdown grant is unchanged and must not be repurposed for reports.
A future implementation needs a separate versioned Analytics-only request containing
format, ranking and bounded query, with no renderer text/path/URL. Main must validate
the live window/webContents/session/main-frame/document generation, reobtain and
validate the aggregate through the fixed authenticated endpoint, bind the result to
that operation, reject revocation/overlap, and grant writes only through a native
destination dialog and explicit replacement confirmation. CSV extension/size/destination
checks need their own review and disposable cancel/overwrite/race acceptance.
This is a design requirement, not an exposed IPC or a reusable Artifacts permission.

## Security review note

This increment changes only the browser projection and its additive validation
schemas. No endpoint, handshake, cookie, static-serving policy, worker accounting,
database, source-session access, native preload or main-process authority changes.
Bounded reads, strict aggregate admission and explicit format encodings protect the
export boundary. Model metadata privacy, spreadsheet reprocessing and browser-controlled
save behavior remain the limits described above. Synthetic integration and independent
QA evidence must be reported separately from real-provider or native-save acceptance.
