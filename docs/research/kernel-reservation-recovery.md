# Kernel reservation recovery: reference review

Research baseline: 2026-11-05. This note records design research, not an implemented
recovery mechanism or acceptance result. No reference source is incorporated.

## Anywh

The inspected checkout is commit
[`546f189c04415c3c5af5f40e3931a0a90b9aba31`](https://github.com/anywh-sh/anywh/tree/546f189c04415c3c5af5f40e3931a0a90b9aba31).
Its root [LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
is Apache-2.0; its tracked tree contains no NOTICE file. The architecture,
agent-host, and runtimes documentation were read with the implementation.

- [`instanceLock.ts`, `takeLockFile` and `acquireInstanceLock`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/instanceLock.ts)
  uses Node fs, net, crypto and `processTree`. Its non-Linux path removes a
  lock when its PID is considered stale and explicitly documents a takeover
  race. **Keep ORQST**, because this does not authenticate a historic kernel
  identity or implement reciprocal dispatch/recovery fencing.
- [`processTree.ts`, `agentProcessMap` and `sweepAgentProcesses`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/processTree.ts)
  use Linux `/proc` environment markers and signals; the code states this
  approach does not enumerate escaped processes on macOS. **Do not use** for
  macOS recovery: a marker can be removed and signal delivery is outside the
  approved cross-launch authority.
- [`AgentHost.start` and `restore`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/agentHost.ts)
  lock, sweep and restore prior running entries as stopped. **Keep ORQST**:
  its durable evidence must preserve unknown lifecycle and cannot turn an
  absence observation into an exit fact.

## Tucano

The inspected checkout is commit
[`0501956d127699300209902e889f3e69a0948766`](https://github.com/eduwxyz/tucano/tree/0501956d127699300209902e889f3e69a0948766).
Its root [LICENSE](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE)
is Apache-2.0; its tracked tree contains no NOTICE file.
[`Db.interruptStaleRuns`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/db.ts)
marks runs interrupted on application restart; its SQLite/domain types do not
supply a durable kernel identity. [`route`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts)
selects speakers using engine/shared domain types and does not establish process
ownership. **Do not use** either for reservation release: neither supplies the
required process evidence, admission lock, or failure-closed archival contract.
