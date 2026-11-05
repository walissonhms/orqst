# Tauri webview policy review — 2026-11-04

Base: `f8db3dd4e631731e4b95d40b29f249918476725b`. This review concerns webview
permissions, downloads and document navigation only. It does not accept native
behavior, providers, the Core or Electron retirement.

## Exact sources and reuse decisions

| Candidate          | Source, contract and decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ORQST Electron     | `apps/desktop/src/main.ts`, `start`: the private session denies permission requests/checks/device grants and `will-download`; `policy.ts`, `allowedNavigation` restricts documents to the exact origin and `dashboardPathSchema`, with no credentials/query. **Keep this policy and narrowly adapt its document allowlist to Rust.** `allowedRequest` additionally filters resource requests; navigation alone is not that resource filter.                                                                                                                                                                                                            |
| Anywh native shell | [`client/src-tauri/src/lib.rs`, `run_with`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/lib.rs), [`tauri.conf.json`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/tauri.conf.json). Tauri plugins, native microphone permission integration, global Tauri exposure and null CSP differ from ORQST. **Keep ORQST's boundary**; copying this configuration would not supply deny-all webview permissions. Architecture, Agent Host and runtime contract documents were re-inspected at this pin; no host/driver/session changes are needed. |
| Tucano browser     | [`src/main/browser.ts`, `Browsers.win`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/main/browser.ts). Electron session denies permission requests and cancels downloads, but persistent per-agent browser profiles, arbitrary browsing and visible popup allowance differ. **Keep ORQST's existing restrictions**, using supported Tauri callbacks rather than importing a browser service. Its router/agent communication is outside this policy and remains unchanged.                                                                                                                                       |
| Tauri              | [`Builder::on_permission_request`](https://github.com/tauri-apps/tauri/blob/993038c49185307dfc895ab7657d77ca0d5ed7c7/crates/tauri/src/app.rs), [`WebviewManager::prepare_webview`](https://github.com/tauri-apps/tauri/blob/993038c49185307dfc895ab7657d77ca0d5ed7c7/crates/tauri/src/manager/webview.rs), [`WebviewBuilder::on_download`](https://github.com/tauri-apps/tauri/blob/993038c49185307dfc895ab7657d77ca0d5ed7c7/crates/tauri/src/webview/mod.rs). **Use existing dependency APIs**, without a new plugin or feature.                                                                                                                      |
| Wry backends       | Published `wry 0.57.1` sources below. **Use through Tauri's existing runtime**, without copying or replacing backend delegates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

ORQST's `managed-terminal.ts`, `createManagedTerminals`, and `managed-agents.ts`,
`createManagedAgents`, separately install the same request/check/device/download
denials in their sessions. All three session partitions omit `persist:` and use
`cache:false`; they are not permission grants for a Tauri data store.

Anywh and Tucano root LICENSE files at these exact pins are Apache-2.0; neither
checkout has a root NOTICE. Existing attributed ORQST adaptations and NOTICE are
preserved. No third-party source/assets or dependency closure are incorporated.
Tauri, tauri-runtime-wry and Wry package metadata and bundled LICENSE files offer
Apache-2.0 OR MIT. Overclock source/assets are not used.

The requested historical `docs/architecture/implementation-plan.md` and
`docs/architecture/tucano-audit.md` are absent from the base tree. This review does
not reconstruct or rewrite them. Current retirement/security/V6 documentation,
the six preserved V6 originals and pinned research checkouts supplied context.

## Locked APIs and source integrity

`apps/tauri/src-tauri/Cargo.lock` resolves Tauri **2.12.5**,
tauri-runtime-wry **2.12.3**, Wry **0.57.1**. Inspected files were compared byte for
byte with the cached published crate archives, whose hashes match the lock:

| Package                  | SHA-256                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| tauri 2.12.5             | `5fb0244332cfb9cee7e2a568bf5da29a36ed8fdbd717f6f47a66b6b7b358c072` |
| tauri-runtime-wry 2.12.3 | `e1aa9d8b7a120f879f44fdc1053f7b7dbf416bf0bbc6a72b714dec46b782b52f` |
| wry 0.57.1               | `759c50ddad0ef9913bb5496cb9d509a50433a3b78cb0238d61105526589cf0e9` |

Tauri/runtime crate VCS metadata pins `993038c49185307dfc895ab7657d77ca0d5ed7c7`.
Wry metadata records `2446feadae623d6f2ac8d2136e3ccef3d7197e0e` **with `dirty:true`**:
the published archive, not an assumed identical clean Git checkout, is the
authority for the observed Wry behavior. Versioned source links below refer to
that published release.

The global callback signature is `Fn(Webview<R>, PermissionKind) ->
PermissionResponse + Send + Sync + 'static`; it has no extra feature/cfg gate.
Both builders expose `on_download` with `Fn(Webview<R>, DownloadEvent<'_>) ->
bool + Send + Sync + 'static`. `false` rejects `Requested`; the result on
`Finished` does not undo a download. ORQST already enables `unstable` for child
webviews and default Wry support. No manifest/lock/config changes are necessary.
`tauri-runtime-wry/src/lib.rs`, `create_webview`, forwards permission/download
callbacks to Wry; `webview_permissions.rs` maps permission responses directly.

## Effective differences before the change

- **Permissions on macOS:** Tauri `prepare_webview` installs no permission handler
  when neither app nor webview supplies one. Wry
  [`request_media_capture_permission`](https://docs.rs/crate/wry/0.57.1/source/src/wkwebview/class/wry_web_view_ui_delegate.rs)
  explicitly uses `WKPermissionDecision::Grant` when its handler is absent.
  With the callback, `Deny` maps to native `Deny`, including combined camera/mic
  requests. This is a source-backed policy gap, not proof that OS/TCC grants access.
- **macOS support limits:** this delegate is guarded by
  `not(macos_12_unavailable)` and implements media-capture permission only.
  [`PermissionKind`](https://docs.rs/crate/wry/0.57.1/source/src/permissions.rs)
  explicitly marks geolocation, notifications and clipboard-read unsupported by
  this backend. The broad Tauri API wording does not establish support for every
  permission. The change does not replace native delegates, override saved browser
  decisions, alter TCC or claim Electron's device/check hooks exist in Wry.
- **Windows permissions:** Wry
  [`InnerWebView::init_webview`](https://docs.rs/crate/wry/0.57.1/source/src/webview2/mod.rs)
  installs `PermissionRequested` when a handler exists. `Deny` sets
  `COREWEBVIEW2_PERMISSION_STATE_DENY`; `Default` leaves the browser's flow.
  Unknown kinds map to `Other` and are also denied. No Windows execution was done.
- **Linux permissions:** Wry
  [`InnerWebView::attach_handlers`](https://docs.rs/crate/wry/0.57.1/source/src/webkitgtk/mod.rs)
  connects `permission-request` only with a supplied handler. Deny calls
  `request.deny()` and handles the signal; the media branch checks combined
  camera/mic and display requests. The `PermissionResponse` documentation says
  Linux default is deny; absence is not reported here as permissive.
- **macOS downloads:** Wry
  [`navigation_policy` / `navigation_policy_response`](https://docs.rs/crate/wry/0.57.1/source/src/wkwebview/navigation.rs)
  cancels download-attribute navigation without a started handler. An unshowable
  MIME response selects Download only with that handler; otherwise it returns
  Allow. Therefore missing `on_download` alone was not proof of permissiveness.
  With the explicit callback,
  [`download_policy`](https://docs.rs/crate/wry/0.57.1/source/src/wkwebview/download.rs)
  gives the destination completion handler a null URL when denied. Download
  navigation APIs are available on macOS 11.3+/iOS 14.5+; older systems retain
  their source-defined behavior. No claim of complete legacy-OS coverage.
- **Windows downloads:** Wry installs `DownloadStarting` only with a download
  callback; rejection calls `SetCancel(true)`. The
  [WebView2 reference](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2downloadstartingeventargs)
  confirms uncancelled downloads proceed through its default download flow/UI.
  This is a concrete difference from Electron's unconditional cancellation.
- **Linux downloads:** Wry registers a context download handler only when supplied.
  [`register_download_handler`](https://docs.rs/crate/wry/0.57.1/source/src/webkitgtk/web_context.rs)
  calls `download.cancel()` on denial. The
  [WebKitGTK default destination reference](https://webkitgtk.org/reference/webkit2gtk/stable/signal.Download.decide-destination.html)
  documents a default Downloads destination when the signal is unhandled.
  All ORQST webviews install the same denial, including shared-context children.
- **Navigation:** the existing Tauri dashboard allowed arbitrary same-origin paths,
  e.g. `/api/bootstrap` or `/assets/app.js`, as documents. Electron limits them to
  SPA routes. The new pure path check matches the existing protocol schema,
  including canonical `encodeURIComponent` session IDs, UTF-8 validation and the
  JavaScript UTF-16 200-unit limit. Root `/`, all current views, session paths and
  fragments remain available. The original origin/credential/query guard and the
  exact unavailable document remain authoritative. Other custom documents keep
  their existing exact URL checks and popup denial.

## Open gaps for Electron retirement

- **Session storage:** Electron's three session types above are non-persistent.
  ORQST's current Tauri builders do not request incognito or a distinct data store.
  Wry [`InnerWebView::new`, data-store selection](https://docs.rs/crate/wry/0.57.1/source/src/wkwebview/mod.rs)
  selects `WKWebsiteDataStore::defaultDataStore` without an incognito/custom-store
  request. `WebViewAttributes::default` in `src/lib.rs` sets `incognito:false`.
  This is a remaining persistence boundary difference, not changed by denial
  callbacks. No store reset, new flag or profile clearing was performed.
- **Persisted grants:** Tauri explicitly warns that browser-saved decisions may
  bypass a new permission-request callback. Denial of new callbacks is not proof
  that prior grants were revoked. No user profiles or saved permissions were read
  or cleared, and integral permission parity is not established.
- **macOS callback coverage:** Wry's media delegate supplies no geolocation,
  browser-notification or clipboard-read callback. These remain open platform
  evidence gaps even though a global deny policy is installed. This does not
  imply those APIs are permissive or usable, nor accept their native behavior.

## Remaining boundary

The global denial governs new permission requests reaching supported backend
callbacks. Tauri documents that persisted browser decisions can bypass this hook;
this change does not clear user profiles or claim a permission-reset mechanism.
macOS geolocation, browser notifications, clipboard and other unsupported native
permission callbacks remain platform acceptance/research gaps. Native notification
plugin authority is separate and unchanged. Denying a download destination does
not promise zero preceding network traffic.

This policy is not Electron's `onBeforeRequest` interceptor. The unchanged bridge
and custom-protocol CSP, exact documents, IPC capabilities and signed/focused
native commands continue to constrain resources/authority. Full effective resource
filter parity is not established by this increment. Native save/open/export use
`files.rs` dialog/private-pipe operations and existing Node savers, not browser
downloads; no file/export command, guard or writer is changed.

Standalone Rust path tests passed. URL-composition unit tests are committed for
the coordinated Cargo run. No Cargo command, dependency install, resource staging,
native build, app launch, CLI/provider or user-state operation was performed.
See [delivery checks and acceptance](../development/tauri-webview-policy.md).

## Renderer termination and webview data stores — 2026-11-05 (source state)

The locked Tauri/Wry macOS runtime exposes a public web-content termination
callback; without it the runtime attempts an automatic webview reload. The
native builder now installs it before any webview exists. The handler keeps a
per-label latch, revokes only the terminated document's authority through
narrow wrappers, hides a dead child so it cannot cover the message, and presents
the static unavailable document with a renderer cause. It does not stop,
signal, retry, adopt a process or create a Core, and a duplicate or obsolete
callback does not loop. Native macOS acceptance is pending.

Dedicated child views use a nonpersistent WebKit data store (`incognito(true)`);
the dashboard keeps the default store because it owns persisted preferences.
No existing store data is deleted or copied; preference migration is open.

`on_web_resource_request` covers only Tauri's own `tauri` protocol, not external
loopback HTTP, so it is not an Electron `onBeforeRequest` replacement. macOS
permission categories without a callback (geolocation, browser notifications,
clipboard read) remain open and are not claimed as enforced.

## Feature permission matrix — 2026-11-05 (source state)

The matrix editor and native command are present but are not functional or
security-validated. The dynamic chrome capability does not grant the command,
the current focus and private-channel checks reject its requests, and the native
review does not yet bind the exact active Feature, document and policy to the
save. The Node service currently fixes the actor and reports all save failures as
stale, including possible post-commit failures. Do not enable the command until
these gaps are corrected and tested. The existing Core policy store uses CAS and
audit, but that does not prove the editor's end-to-end authorization. CSP is
unchanged. Reset is not implemented; an empty allowlist denies all operations.
Native acceptance remains pending.
