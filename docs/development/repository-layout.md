# Repository layout

```
orqst/
├── apps/
│   ├── bridge/                 # composition root: config, HTTP, WS, runtime
│   │   ├── src/config.ts
│   │   ├── src/app.ts
│   │   ├── src/main.ts
│   │   └── src/server.ts
│   └── dashboard/              # React SPA
│       ├── src/App.tsx
│       ├── src/use-observatory.ts
│       ├── src/i18n.ts
│       ├── src/locales/{en-US,pt-BR}.json
│       └── vite.config.ts
├── packages/
│   ├── core/                   # observation lifecycle, store and observer ownership
│   ├── protocol/               # zod schemas, event types, read models
│   ├── shared/                 # stable IDs, redaction, safe text
│   ├── database/               # node:sqlite store, migrations, retention
│   └── adapters/
│       ├── codex/              # implemented observer + normalizer
│       ├── claude/             # descriptor contract only
│       └── opencode/           # descriptor contract only
├── docs/
│   ├── architecture/
│   ├── adapters/
│   ├── api/
│   ├── development/
│   ├── deployment/
│   └── commercial/
├── scripts/
│   ├── build.mjs               # dashboard build + esbuild bridge bundle
│   ├── dev.mjs                 # bridge watch + Vite
│   └── validate-local.ts       # real Codex data validation
├── tests/
│   ├── fixtures.ts             # synthetic records only
│   ├── normalizer.test.ts
│   ├── store.test.ts
│   ├── observer.test.ts
│   └── api.test.ts
├── .github/workflows/          # GitHub Actions validation workflow
├── .env.example
├── CONTRIBUTING.md
├── LICENSE                     # Apache License 2.0
├── README.md
├── SECURITY.md
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.json
```

## Package responsibilities

### `packages/protocol`

Defines the contract only. No filesystem, HTTP, database, or React code.

- `eventSchema`, `payloadSchema`, `usageSchema`, `statusSchema`,
  `preferencesSchema`
- `eventTypes`
- `AdapterCapabilities`, `AdapterDescriptor`
- `SessionView`, `WorkspaceView`, `NotificationView`, `Snapshot`
- `StreamMessage`

### `packages/shared`

Pure helpers used by adapters and the store:

- deterministic IDs;
- credential redaction;
- safe text extraction and truncation;
- defensive object/string access for untrusted JSON.

### `packages/database`

Owns persistence:

- schema migration and `user_version`;
- prepared statements and transactions;
- idempotent event ingestion;
- session/workspace/token/notification read models;
- checkpoints and retention;
- data-directory hardening.
- read-only qualified model Analytics projection over retained evidence.

### `packages/core`

`ObserverCore` owns the store, Codex observer and retention lifecycle. It exposes
initialization/readiness, event subscriptions, diagnostics, failure reporting and
idempotent shutdown. It does not import transport, Electron or dashboard modules.

### `packages/adapters/codex`

The only adapter that produces events. Split into:

- `index.ts` — root validation, recursive discovery, watching, polling,
  checkpointing, chunked reading, diagnostics, lifecycle;
- `normalize.ts` — provider record → protocol event mapping and adapter state.

### `packages/adapters/claude` and `packages/adapters/opencode`

Each exports a descriptor with `implemented: false` and all capabilities
`false`. No runtime behavior.

### `apps/bridge`

Executable composition and local transport:

- `config.ts` — environment parsing;
- `main.ts` — startup, signal handling and process failure reporting;
- `app.ts` — Core/transport composition and coordinated lifecycle;
- `server.ts` — REST routes, authentication, static files, WebSocket upgrade,
  replay, broadcast, heartbeat.

### `apps/dashboard`

React UI and browser transport:

- `use-observatory.ts` — bootstrap, snapshot, WebSocket, cursor deduplication,
  reconnect, polling fallback;
- `App.tsx` — all views;
- `i18n.ts` and `locales/` — localization;
- `styles.css` — Tailwind v4 import plus component styles.

## Dependency direction

```
shared      (leaf: crypto helpers, redaction, safe text)
protocol    (leaf: zod schemas and shared types)
database    ← protocol, shared
adapters/*  ← protocol, shared, database
core        ← protocol, database, adapter-codex
bridge      ← core, protocol, shared, database, adapters
dashboard   ← protocol
```

Rules:

- `protocol` depends on nothing local.
- `shared` depends on `protocol` only if a shared type is needed; currently it
  is standalone helpers.
- `database` depends on `protocol` and `shared`.
- Adapters depend on `protocol`, and the Codex adapter also on `shared` and
  `database` (for the store type).
- Core composes observation resources without transport/UI dependencies.
- The bridge depends on Core and the packages needed for local transport.
- The dashboard depends on `protocol` and browser libraries only.
- No cycles. Adapters never import the bridge or the dashboard.

## Generated and local-only paths

Ignored by Git and not part of the source layout:

- `node_modules/`
- `dist/`
- `apps/dashboard/dist/` (inside `dist` ignore patterns)
- `*.db`, `*.db-shm`, `*.db-wal`
- `.env`, `.env.*` (except `.env.example`)
- `coverage/`, `playwright-report/`, `test-results/`
- `.overclock-app/`, `.codex/`, `.opencode/` (local tool state)
- `.DS_Store`

## Intentional absences

- **No `apps/server`.** One bridge process is the architecture.
- **No `packages/ui`.** The dashboard is the only UI consumer; a shared UI
  package would be empty abstraction.
- **No `packages/config` or `packages/licensing`.** Configuration is one file;
  licensing is recorded in LICENSE and documentation.
- **No Cloud backend.** Optional identity/device/connectivity is design only;
  the future control-plane stack remains undecided.
- **No Turborepo.** Two build targets, two scripts.
- **No Docker or standalone installer.** Local development, `pnpm start` and
  the macOS user-service helper are available; no cross-platform installer exists.

## Manifest notes

- All packages are `private: true` and `"license": "Apache-2.0"`.
- The workspace globs are `apps/*`, `packages/*`, and `packages/adapters/*`.
- `apps/bridge` is a private executable composition root and has no package export. It runs via `src/main.ts` in development and the root bundled entry point in production.

## Planned boundaries

The layout above includes the integrated observer Core and Analytics library.
Broader Phase 1 contracts and durable historical measurements remain incomplete.
There is no accepted Desktop, PTY runtime,
orchestrator or Cloud implementation. New packages must follow the approved phase and
have concrete responsibilities; see [ROADMAP](../../ROADMAP.md) and
[target architecture](../architecture/overview.md#target-module-responsibilities--planned).
