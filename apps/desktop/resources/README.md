# ORQST application icons

The owner supplied `ORQST-Icons-Mac-Windows-Linux.zip` for integration on
2026-11-02. Archive SHA-256:
`5be8cffbc0ef5cc7ad707790387ed1853a53fcd0d8031aaac8f19a02da43e0d4`.

`icons/` preserves the supplied PNG, ICO and ICNS files without modification.
`orqst-master.png` was omitted because it is byte-identical to `orqst-1024.png`.
The dashboard's `public/orqst.ico` is an unchanged copy of the same ICO.

These are owner-submitted project branding assets, intentionally supplied for
inclusion under the repository's existing [contribution terms](../../../CONTRIBUTING.md)
and [Apache-2.0 licensing decision](../../../docs/commercial/licensing-decision.md).
The archive contains no license, attribution or authorship metadata. Its source
is the owner's submission; original authorship and any third-party rights were
not independently established. No external project assets were downloaded or copied.
Apache-2.0 does not grant trademark rights.

## Runtime and distribution

- macOS: the PNG supplies the running Dock icon. The 16/32 px images supply a
  1x/2x template tray silhouette using their alpha channel. The ICNS is retained
  for a future explicitly approved application packaging pipeline.
- Windows: the multi-resolution ICO supplies the window and tray icons.
- Linux: the PNG supplies the window icon; 16/32 px representations supply the tray.
- Browser dashboard: the ICO supplies the favicon through existing static serving.

`pnpm build:desktop` copies `icons/` beside the compiled main process in
`apps/desktop/dist/icons/`. Runtime paths never depend on the current working directory.
The checkout client does not replace Electron's installed bundle/executable icon.
There is no installer or packaging configuration yet; Windows/Linux selection is
implemented in code and requires acceptance on those operating systems.

References: Electron's [nativeImage formats and scaling](https://www.electronjs.org/docs/latest/api/native-image),
[Dock icon](https://www.electronjs.org/docs/latest/api/dock#dockseticonimage-macos),
and [platform tray behavior](https://www.electronjs.org/docs/latest/api/tray).
