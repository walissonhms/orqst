# Contributing to ORQST

ORQST Community Edition is open source under [Apache-2.0](LICENSE) and is currently
pre-release.

## Contribution licensing

Contributions intentionally submitted for inclusion in ORQST are licensed under
Apache-2.0, as described in section 5 of the license, unless explicitly stated
otherwise. Submissions under different terms require the owner's agreement before
merging. No separate CLA or DCO is required by this repository.

- Submit only material you have the right to contribute and disclose any
  third-party provenance, license and attribution requirements.
- Preserve applicable copyright, license and notice files.
- Do not paste code from another project. Tucano is an architectural reference,
  not a source of code for this implementation.
- Changes to the project's license require explicit owner approval.

See [docs/commercial/licensing-decision.md](docs/commercial/licensing-decision.md).

## Before you start

1. Read [README.md](README.md) and
   [docs/architecture/overview.md](docs/architecture/overview.md).
2. Read [ROADMAP.md](ROADMAP.md) and the architecture decisions. The current
   runtime observes agents; managed execution is an approved future direction.
   Phase 0 permits architecture/contract documentation and the explicitly authorized
   standalone optimizer research benchmarks; no production optimization. Phase 1 and
   every later implementation phase require explicit approval before work starts.
3. For a nontrivial change, open a design note or issue first. Describe the
   problem, the proposed boundary, and what evidence will prove the change.

## Architecture and compatibility

- Preserve the operational Codex observer, bridge, dashboard and local data.
- Keep observability as the primary product experience. Do not replace activity,
  delivery and usage views with a terminal-first experience.
- Distinguish implemented, in-progress and planned capabilities in every change.
- Follow [planned lifecycle contracts](docs/api/lifecycle-contracts.md) for future
  control designs; they are not current APIs or permission to implement them.
- Keep current v1 REST/WebSocket contracts and database migrations compatible.
  Publish a separate negotiation/migration plan before adding new contract families.
- New protocol/domain modules must remain independent of Electron and Cloud.
- Keep identifiers, comments, contracts and docs in English. New UI keys must be
  provided in both en-US and pt-BR; captured content keeps its original language.
- Update public architecture/API docs and the Unreleased changelog when their
  contracts change. Keep local agent instructions, working notes and acceptance
  reports out of version control.
- Record security and compatibility evidence for a capability before enabling it.
  Commit each completed feature/fix after its relevant checks; do not publish a
  release or start the next phase merely because a design was approved.

## Development setup

```bash
corepack enable
pnpm install
pnpm dev
```

Requirements: Node.js `>=24 <25`, pnpm `10.x`, macOS for the primary target.
Full details are in [docs/development/setup.md](docs/development/setup.md).

## Making a change

1. Create a focused branch.
2. Keep changes small and consistent with the existing structure.
3. Follow the project conventions:
   - English identifiers, comments, schema, API, and docs.
   - All user-facing dashboard strings through i18next, with both `en-US` and
     `pt-BR` entries.
   - Strict TypeScript, no `any`.
   - No new abstraction without a concrete need.
4. Add or update tests for behavior changes. Synthetic fixtures only.
5. Update documentation in the same change when behavior, API, schema, or
   configuration changes.

## Commit messages

Use Conventional Commits where practical:

```
feat(codex): handle truncated session files
fix(api): reject invalid cursor values
docs(adapters): clarify Claude capability status
test(store): cover retention with active notifications
chore: update development dependencies
```

Keep the subject imperative and under ~72 characters. Explain the "why" in the
body when the change is not obvious.

## Verification

Run what applies to your change:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For ingestion changes, also run the real-data validation described in
[docs/development/testing.md](docs/development/testing.md):

```bash
pnpm validate:local
```

Report exactly what you ran. Do not claim a check passed if you did not run it.
Do not weaken a test or lint rule to make a failure disappear.

## Test data policy

- Never commit real captured agent sessions, prompts, tool output, paths that
  identify a person, credentials, or customer data.
- Test fixtures must be synthetic and labeled as such.
- If a bug requires a real record to reproduce, reduce it to a minimal synthetic
  shape before committing.

## Pull request checklist

- [ ] The change stays inside its explicitly approved phase; current observation
      behavior is preserved.
- [ ] The current observer remains read-only; any future managed execution is
      explicitly authorized for its phase and has separate permission boundaries.
- [ ] Event schemas validate at runtime; source references are preserved.
- [ ] Status and token rules are unchanged or the change is documented.
- [ ] Security controls (loopback, origin checks, path containment, limits)
      remain intact.
- [ ] User-facing text exists in both locales.
- [ ] Tests cover the new behavior with synthetic data.
- [ ] Docs are updated where behavior changed.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` were run, or
      the PR states which were not run and why.
- [ ] License and lockfile changes are authorized and relevant; generated output,
      local agent instructions, captured sessions and unrelated changes are excluded.

## Security reports

Do not open a public issue for a vulnerability. Follow
[SECURITY.md](SECURITY.md).

## Code of conduct

Be direct, technical, and respectful. Critique the change, not the person.
Assume good faith, ask for evidence, and keep discussions in the repository so
decisions remain traceable.
