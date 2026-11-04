# Native webview policy contract

`tauri::Builder::on_permission_request` returns `PermissionResponse::Deny` for
every new request delivered by the backend, without kind/origin exceptions.
It is not a renderer command or capability. Backend support and persisted browser
decisions limit what reaches the callback; no device-enumeration/check API or OS
permission reset is added.

The dashboard, terminal child, Feature chrome child and managed-agent window each
return `false` from `on_download`. On `DownloadEvent::Requested`, Tauri/Wry reject
the download. The `Finished` response cannot cancel a completed download. Native
file operations continue through existing `file_request`/dialog/private Node
savers and retain their exact source/document/focus/revocation checks.

Dashboard navigation is the intersection of `unavailable::allowed_navigation`
and either the exact unavailable URL or `webview_policy::dashboard_path_allowed`.
The path contract mirrors `packages/protocol/src/dashboard-routes.ts`: `/`, the
seven current SPA routes, or canonical bounded `/overview/sessions/<id>` paths.
No origin, query, credential or custom-document exception is added. This check
does not filter API fetches/WebSockets or replace CSP; API resources cannot become
dashboard documents through the navigation callback.

See [versioned source/default differences](../research/tauri-webview-policy.md)
and [checks and remaining native acceptance](../development/tauri-webview-policy.md).
