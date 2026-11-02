# Model Manager: observation boundary

The first Model Manager increment qualifies the existing session-header model field.
It is an **observed model identifier**, displayed as inert original text in both
English and Portuguese UI. It is not a model picker. Discovery, selection, defaults,
reasoning/speed controls and model changes remain unimplemented.

The inspected baseline declares Node `>=24 <25`, pnpm `10.34.9`, strict TypeScript
`~6.0.3`, React `^19.3.1`, Vite `^8.3.5`, i18next `^26.7.1`, Zod `^4.6.7`,
Electron `45.2.1` and built-in `node:sqlite`. This increment adds no dependencies
and preserves the Core/Bridge/adapter/protocol/dashboard boundaries.

## Existing evidence and its limits

| Layer                | Implemented source                                                                                                                            | Meaning and limit                                                                                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex adapter        | `packages/adapters/codex/src/normalize.ts`: `turn_context.payload.model` and `event_msg:task_started.payload.model` update `CodexState.model` | Explicit identifiers are remembered and may be propagated into later normalized token events. A token event's timestamp therefore does not establish when its model was declared.                                                                        |
| Protocol             | `packages/protocol/src/index.ts`: optional event `payload.model`, nullable `SessionView.model`, source references and turn correlation        | Identifies a historical observation; no model catalog, account entitlement, configured default, reasoning/speed capability or selection contract exists.                                                                                                 |
| Store                | `packages/database/src/index.ts`: `ingest()` and `sessions()`                                                                                 | A truthy model updates the summary only when its event timestamp reaches session `last_activity`. An out-of-order declaration can remain in event/compact evidence without changing the summary. The summary need not be the latest model in the source. |
| Analytics            | `packages/database/src/analytics.ts`                                                                                                          | Uses compact model declarations and qualified token intervals. Header model is not an attribution rule for tokens or cost.                                                                                                                               |
| Core                 | `packages/core/src/index.ts`                                                                                                                  | Owns observation, store and retained-evidence queries. Does not resolve available models or manage provider processes.                                                                                                                                   |
| Adapter descriptors  | `packages/adapters/*/src/index.ts`                                                                                                            | Codex observation is implemented; Claude Code/OpenCode remain contracts. Observation capabilities do not prove model discovery or execution capabilities.                                                                                                |
| Dashboard / Electron | `apps/dashboard/src/App.tsx`, existing isolated Electron renderer                                                                             | Shared header qualifies the existing field. No new API, IPC, database change, filesystem read or provider request is added.                                                                                                                              |

The header deliberately has no model timestamp: `SessionView.lastActivity` is not the
model's observation time. Its disclosure states that observation time is unavailable,
the source may have a newer identifier, and availability, capabilities and selection
have not been verified. A null summary displays **Not recorded**, never a default or
a healthy empty catalog. The disclosure remains useful even without a model value.
The UI does not attribute tokens, provider identity, billing or costs to that field.

## Discovery inventory, not implemented capabilities

Static local inspection identified Codex CLI **0.162.1** package metadata and an
existing `models_cache.json`. Inspection was limited to structural metadata; private
identity values, configured values, session content and credentials are not documented.
The installed executable contains `model/list`, `includeHidden`,
`supportedReasoningEfforts`, `model_catalog_json` and `generate-json-schema` strings.
These are candidate integration surfaces, not proof that an operation works or that
a model is accessible. No Codex command, app-server process or inference was run.

| Candidate                          | Evidence it could supply                                                       | Why it cannot authorize a picker today                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Retained normalized observations   | A model identifier was observed for a session                                  | Historical use is not present availability or selection permission.                                                                                                      |
| Local Codex model cache            | Version/freshness metadata and cached model descriptions                       | Internal format, stale/custom entries, source trust and privacy need a reviewed bounded allowlist. Do not ingest the whole cache or its identity/configuration material. |
| Configured model/catalog           | An explicit configuration choice or catalog override, if safely projected      | Configuration is neither verified access nor current session state. Configuration is not read by this increment.                                                         |
| Documented app-server `model/list` | Picker entries, visibility and effort options; values depend on client/account | Requires a separate process integration, not implemented or invoked by ORQST. Catalog entries can be bundled rather than entitlement-checked.                            |
| Provider API model list            | Provider/account-specific metadata                                             | Network/authentication and provider identity are separate gates. No provider calls are made here.                                                                        |

The [official app-server documentation](https://learn.chatgpt.com/docs/app-server#models)
describes paginated `model/list`, hidden entries and reasoning options. The
[ChatGPT-plan integration documentation](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
explicitly cautions that a bundled catalog can be returned and does not verify
entitlement. Documentation is a research source, not local integration validation.
This increment makes no claims about in-session switching or Fast support.

## Dependencies of subsequent increments

**Phase 3** must validate discovery separately for each actual provider/version.
A future contract needs distinct observed identifiers, catalog membership,
configured choices and executable selections; explicit source/version/freshness and
completeness; unavailable reasons; and runtime allowlists and bounds. Missing,
permission-denied, malformed, oversized, stale, unsupported or identity-incompatible
sources must not become successful empty or partial catalogs. Any filesystem reader
needs path containment, symlink rejection, bounded reads and generic diagnostics
without paths, private configuration or secrets. No catalog parser or contract is
introduced here.

**Phase 4** owns executable selection/defaults/session overrides and any switch,
restart or resume effect. It requires independently proven provider support,
authorization, ownership and audit. A future UI selection must distinguish a stored
preference from an applied change, and must preserve external sessions. A model
catalog or terminal does not grant these permissions. See [ROADMAP](../../ROADMAP.md)
and the [capability model](../adapters/capability-model.md).

## Verification scope

`tests/browser/model-observation.spec.ts` uses a disposable synthetic source and the
real observer/API/WebSocket/dashboard path. It checks null, source-driven updates,
inert hostile identifiers, English/Portuguese persistence, keyboard disclosure,
absence of selection controls or fabricated model time, and long-ID mobile layout.
Existing ingestion/accounting/security tests remain applicable. These checks do not
validate catalog discovery, account access, native switching or provider capability.
No actual user sessions, service, client or database are required for these tests.
