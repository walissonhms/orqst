# Dashboard visual regression checks

The shared browser/Desktop frontend uses the same CSS and local brand images.
Build before browser checks so the fixture serves the current assets:

```bash
pnpm --filter @orqst/dashboard build
ORQST_BROWSER_PORT=4318 pnpm test:browser tests/browser/brand-assets.spec.ts tests/browser/visual-refinement.spec.ts tests/browser/theme-preferences.spec.ts
```

The fixture starts its own loopback Bridge with disposable, explicitly synthetic
sessions. It never attaches to the installed listener on port 4317. Use another
free test port when parallel work already occupies 4318. Playwright starts and
stops only its own fixture; production services require no restart for these tests.

The visual matrix exercises Overview, Workspace directory, Agents, Model Analytics,
Artifact library, Settings and session details in both palettes and both languages
at 320, 390, 768 and 1440 pixels. It uses the largest interface text preference and
comfortable spacing. Screenshots are generated for desktop and mobile review;
reduced motion makes those captures stable. Additional cases check short-window
sidebar scrolling, Escape/focus restoration, mobile session fields/actions, long
names, evidence-backed running indicators and panel spacing.

Brand checks verify local loading, natural proportions, transparent backgrounds,
source/variant alpha and the retained purple accent, plus explicit and system
appearance changes. The Node asset test pins the inert SVG wrappers and embedded
PNG bytes. Palette tests resolve actual CSS colors and verify normal-text,
semantic-state, control-boundary and focus contrast in standard/high-contrast
modes. Existing suites cover empty/error/offline states, dialogs, artifact drafts,
keyboard paths, preferences and source rendering.

Run the repository lint, typecheck, test and build commands as well. When shared
CSS changes, the complete browser suite provides broader regression coverage:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
ORQST_BROWSER_PORT=4318 pnpm test:browser
```

Screenshots, traces and local logs are generated review material and are not
published. Synthetic Chromium verification does not establish native Desktop,
Safari/Firefox, manual screen-reader or owner visual acceptance. No backend,
ingestion, database migration or managed Terminal behavior is exercised by the
visual increment itself.
