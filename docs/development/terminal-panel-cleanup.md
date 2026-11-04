# Native terminal panel cleanup — 2026-11-03

A disposable Electron cycle acceptance exposed an uncaught exception during quit:
Electron can clear a destroyed `WebContentsView.webContents` property. The panel
manager previously read that property again in `close()`, interrupting teardown.
This occurred in a synthetic temporary profile, not the owner's Desktop.

Panels now retain the owned WebContents handle when registering a view, track whether
attachment completed, and use the retained handle for destruction/layout/focus checks.
Closing before any pane, after partial attachment, after externally destroyed contents,
after window destruction or repeatedly remains idempotent. A closed panel manager
refuses new attachments. A live dashboard is restored; destroyed windows are not
reparented. Cleanup does not release capacity, alter journals, adopt processes or
weaken ownership/grant checks. Selection release still needs separate signed retirement
and fully confirmed cleanup.

Four synthetic unit tests exercise these cases without launching Electron or a provider.
The two-cycle Electron acceptance separately validates the complete retirement path;
its initial interrupted run is failure evidence, not a passing acceptance.
