# Terminal creation and operational Open review — 2026-11-04

Pinned Anywh source: `546f189c04415c3c5af5f40e3931a0a90b9aba31`, inspected from
its separate audit object store. The required starting documents are
[architecture](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/architecture.md),
[agent host](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/agent-host.md),
and [runtime contract](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/README.md).

| Candidate       | Exact source and decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launcher        | [`NewAgentLauncher`, `submit`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/components/sala/NewAgentLauncher.tsx): keep ORQST's existing Studio drawer. Reuse the behavioral separation of provider/model selection and actual launch, without copying React/Radix/context delegation code. Upstream inherits parent permission mode; ORQST requires its own exact native review and three distinct signed grants.                                                                                    |
| Model display   | [`effectiveModel`, `catalogHasModel`, `labelForModel`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/lib/composer/modelCatalog.ts): keep the Core-supplied, scoped ORQST catalog. Upstream module cache is CLI-version information, explicitly not account entitlement; neither analytics identifiers nor cached labels prove access.                                                                                                                                                                  |
| Catalog probing | [`probeModelCatalog`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/probes/modelCatalog.ts), [`parseClaudeModelCatalog`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/claude/modelCatalog.ts): do not copy effectful probing into this UI increment. It spawns providers, which is outside the authorized validation. Passive native configuration/default discovery remains explicitly unverified for entitlement.                 |
| Drivers         | [`CodexSessionDriver`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/codexDriver.ts), [`ClaudeSessionDriver`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/defs/claude/driver.ts): retain ORQST TerminalNativeBroker, supervisor and real xterm/PTY. Upstream uses app-server or stream-json turns, not the current interactive document/attachment/input lease contract. It also depends on host/session/MCP/usage infrastructure. |

The exact upstream `LICENSE` is Apache-2.0. No root `NOTICE` exists in the pinned
tree. Client package dependencies include React, Radix, lucide and Tauri APIs;
relay dependencies include node-pty, ws, smol-toml and gpt-tokenizer. No code or
assets from these candidates are incorporated, and no dependency is added.
Existing attributed Anywh adaptations and root NOTICE remain intact.

Tucano communication is unchanged, so no new communication reuse is proposed.
Overclock remains a visual experience reference only; no licensed source or
assets were identified or copied. The preserved V6 HTML remains the layout
reference; its simulated content is not used in production.
