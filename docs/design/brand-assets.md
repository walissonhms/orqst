# Approved brand assets

The owner supplied the ORQST logo (880 × 270) and mascot (690 × 590). The reviewed
SVGs each contained only a title and one embedded PNG, with no scripts, event
handlers, animation, styles, links, external references or XML declarations.
These are raster images inside SVG containers, not resolution-independent paths.

The checked-in copies in `apps/dashboard/public/brand/` retain the exact original
PNG bytes, transparency and aspect ratios. Their wrappers were reconstructed with
only `svg`, `title` and `image`, fixed dimensions and a `data:image/png;base64`
source. Unused XLink namespaces were removed and titles use English. No embedded
image data was recolored, cropped, resampled or replaced. The original supplied
files remain untouched outside the repository.

## Placement and accessibility

- `orqst-logo.svg` replaces the provisional bar mark and plain-text wordmark in
  the existing sidebar home link. The existing translated ORQST accessible name
  and image alternative identify the destination. A fixed light backing preserves
  the dark artwork's legibility in both themes without recoloring it.
- `orqst-mascot.svg` replaces the decorative sparkle in the existing empty-session
  welcome. It has an empty alternative and is hidden from assistive technology:
  the adjacent translated heading and instructions carry the meaning. The static
  expression does not report running, completion, connection or any other status.

Both use explicit intrinsic dimensions, automatic rendered height and bounded
responsive widths. The current mobile navigation and collapsed sidebar policies
still apply. No controls, routes, provider icons, favicon, native app icons or
menu-bar artwork are changed.

## Security and maintenance

These are fixed local assets displayed with `img`, never inline SVG, `object`,
`embed` or captured HTML. The existing same-origin image CSP and static SVG MIME
handling remain intact; no new network origin or serving rule is required.
The asset regression test accepts only the reviewed wrapper shape, validates the
PNG header/dimensions and pins each embedded image's SHA-256 digest. This is a
review of these two assets, not a general-purpose SVG sanitizer. Review any future
replacement before updating its test fingerprint; never add active SVG or remote
image/font references.

Browser verification uses disposable synthetic data. Native Desktop visual
acceptance, screen-reader testing and owner artwork acceptance remain separate.
No runtime service restart is needed to review the source change; an already
running installed build needs a separately authorized rebuild/deployment to show it.
