# Approved brand assets

The owner supplied the ORQST logo (880 × 270) and mascot (690 × 590). The reviewed
SVGs each contained only a title and one embedded PNG, with no scripts, event
handlers, animation, styles, links, external references or XML declarations.
These are raster images inside SVG containers, not resolution-independent paths.

The original `orqst-logo.svg` and `orqst-mascot.svg` copies in
`apps/dashboard/public/brand/` retain the exact original PNG bytes, transparency
and aspect ratios. Their wrappers contain only `svg`, `title` and `image`, fixed
dimensions and a `data:image/png;base64` source. The original supplied files remain
untouched outside the repository.

## Theme-aware logo

The original logo already has an alpha channel. The former white rectangle came
from the home link's fixed light CSS background, not from an SVG rectangle or an
opaque PNG. That backing has been removed.

Light mode uses the original dark-ink logo. Dark mode uses `orqst-logo-dark.svg`,
a local transparent derivative of the same artwork, with the same 880 × 270
canvas, letter geometry and purple Q accent. Within the artwork bounds
(x=64–878, y=63–248), dark ink pixels (R<40, G<40, B<80) are mapped to the approved
`#F5F3FF` light ink. Alpha is preserved throughout those bounds. Isolated source
noise outside those bounds is made transparent; no letter or accent is cropped.
The derivative was encoded once at intrinsic size, without resampling. The
original assets remain unchanged. This is a theme legibility derivative, not a
new vector master or a new logo design.

The resolved appearance preference selects the image, including live system-theme
changes. Neither image uses a CSS color filter, blend mode or opaque backing.
Browser regression checks compare source/derivative alpha and visible accent pixels,
check transparent corners and verify that no originally transparent pixel becomes
opaque. Unit tests pin each embedded PNG's SHA-256 and the exact inert SVG wrapper.

## Placement and accessibility

- The logo lives in the existing sidebar home link, including the open mobile
  navigation. Its translated ORQST accessible name and image alternative identify
  the destination. The collapsed desktop sidebar retains icon-only navigation.
- `orqst-mascot.svg` remains decorative in the empty-session welcome, with an empty
  alternative and hidden from assistive technology. Adjacent localized text carries
  meaning; its static expression reports no agent or connection status.

Images use explicit intrinsic dimensions, automatic height and bounded responsive
widths. No provider icons, favicon, native app icons or menu-bar artwork change.

## Security and maintenance

These fixed local assets use `img`, never inline SVG, `object`, `embed` or captured
HTML. Existing same-origin image CSP and static SVG MIME handling remain intact;
no new network origin or serving rule is required. Tests allow only the reviewed
wrapper shape and pinned image bytes. This is a review of these three assets, not
a general-purpose SVG sanitizer. Review replacements before updating fingerprints;
never add active SVG or remote image/font references.

Browser verification uses disposable synthetic data. Native Desktop visual
acceptance, manual screen-reader testing and owner artwork acceptance remain
separate. No user service restart is part of this change; installed builds need a
separately authorized rebuild/deployment to display it.
