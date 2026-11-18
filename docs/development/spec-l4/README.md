# L4 Communication Inspector

The dashboard outlet registers `/comunicacao` in the existing route registry. Its Messages, Queue, Delegations, Audit and Permissions tabs use the standalone inspector. The Studio breadcrumb action reuses the Delegate dialog. The Studio stage, cards and terminal launch flow belong to the other lanes. Entering the route through SPA navigation refreshes the native Feature snapshot.

The Node and Rust terminal hosts expose a bounded read of the existing MCP hub through the private Feature bridge. The hub already owns recipient inboxes, call limits and task results. A relay dequeue supplies the delivery receipt. An explicit result supplies completion or failure. A dequeued task has unknown execution state until the relay submits a result. Retries are explicit, use the original payload and recheck the terminal UUID, Feature, provider and relay connection. The UI exposes up to 20 recent records per Feature. Message previews are clipped at 1,200 UTF-8 bytes and copied as displayed. The Audit tab shows metadata for the current Core epoch. The existing JSONL journal stays metadata-only.

## Screenshots

The Playwright run uses the actual dashboard route and Node hub, plus synthetic members and a mocked desktop bridge for permissions. The pictures show the existing dashboard shell and use pt-BR.

| View          | 1440 × 900                               | 1280 × 800                               |
| ------------- | ---------------------------------------- | ---------------------------------------- |
| Communication | [1440 × 900](communication-1440x900.png) | [1280 × 800](communication-1280x800.png) |
| Delegate      | [1440 × 900](delegate-1440x900.png)      | [1280 × 800](delegate-1280x800.png)      |

## Acceptance gaps

- Cross-Feature sending stays refused. The existing structured cross-Feature service requires an exact native grant and a structured transport. The terminal hub currently has neither binding. The Delegate dialog explains the refusal and the terminal hub returns `not_permitted` for qualified mentions.
- The relay approval tests exercise generated launch configuration. Codex approves the isolated MCP server's enabled tools, Claude allows the server's tool namespace and OpenCode allows its exact tool actions. Live CLI calls and the native permission sheet still need a packaged-app acceptance run.
- The hub currently resolves its stable `T-###` handles. Display names are searchable in the picker. Friendly aliases and the pane-menu entry depend on the Studio and terminal creation work.
- The running state requires provider execution evidence. A relay read establishes delivery, and the hub has no independent task-start event.
