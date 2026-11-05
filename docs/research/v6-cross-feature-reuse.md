# Cross-Feature reuse decisions

This increment reuses ORQST's Store, Feature catalogue, communication journal and
managed pane identities. No upstream code or assets were incorporated.

- [Tucano router at 0501956d127699300209902e889f3e69a0948766](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts#L94)
  selects agents from model/message routing; its [gateway](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/gateway.ts#L30)
  and [SQLite channel membership](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/db.ts#L361)
  do not establish the bilateral revision-bound native grant contract. Decision:
  retain ORQST's journal and do not copy the router or gateway. The pinned
  [LICENSE](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE)
  is Apache-2.0; dependencies and source headers would require a fresh review before copying.
- [Anywh permission bridge at 546f189c04415c3c5af5f40e3931a0a90b9aba31](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/bridges/permissionBridge.ts#L108)
  binds tool approvals to its runtime/host, not this Feature pair and local native
  actor. It depends on Node HTTP/crypto and internal host/MCP contracts. Decision:
  retain ORQST's ownership and journal model, inject a narrow authority port, and
  do not copy the bridge. The pinned [LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
  is Apache-2.0; dependencies and headers need separate review before copying.

The referenced source inspection was performed for proposal h-174. Neither source
supplies evidence of a production native confirmation for ORQST.
