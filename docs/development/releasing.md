# Versioning and releases

ORQST is pre-release. The first candidate is `v0.1.0-alpha.1`, an experimental
source preview, not a stable release or an accepted MVP. Package manifests still
use the private `0.1.0` development baseline; that metadata does not establish a
published version. No dependency or package-version change is required for this
documentation preparation.

## Commits and pushes

- Commit each completed, focused feature or fix after its relevant checks pass.
  Prefer Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Push the reviewed branch explicitly after each completed increment. A commit or
  push does not create a release. Integrate concurrent work without overwriting it;
  do not force-push shared history.
- Update [CHANGELOG.md](../../CHANGELOG.md) for user-visible changes and report
  checks and remaining limits. Keep generated output, local agent instructions,
  working plans, private acceptance reports and captured sessions out of Git.

## Versions

Use one annotated Git tag per deliberately selected version, named `vMAJOR.MINOR.PATCH`
with a prerelease suffix while experimental. Start with `v0.1.0-alpha.1`; use
`v0.1.0-alpha.2`, then subsequent alpha numbers for further previews of this line.
Individual features/fixes do not each need a tag. A new version is a reviewed
snapshot containing one or more completed increments.

Prereleases may change interfaces or storage requirements. Document compatibility,
backup and migration requirements before publication rather than assuming upgrades
are safe. A stable release or `1.0` requires separate acceptance; an alpha tag never
proves provider compatibility, full Desktop/MVP completion or installer availability.
Do not move, overwrite or reuse a published tag; correct the issue in a later version.

## Select and review the target

Before the first tag, the Electron diagnostic-pipe EPIPE fix must be delivered,
validated and included in the proposed target. Review its actual diff and checks;
do not attribute a historical failure to it without retained evidence.

Then select the full commit hash from the integrated branch, review every included
change and update the [preview notes](../releases/v0.1.0-alpha.1.md) to match it.
Include only integrated functionality; pending branches are not release contents.
Record the exact hash and check results in the maintainer review before publishing.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` on that target using
Node 24 and the pnpm version in `package.json`. GitHub Actions also runs Chromium;
check its actual result rather than assuming a push passed. Ingestion changes need
`pnpm validate:local` as described in [Testing](testing.md). Real-provider or native
acceptance requires its separately authorized procedure; synthetic tests do not
replace it. Report failed or skipped checks explicitly.

Confirm the intended remote, a clean target worktree, the target's presence on
`origin/main`, and that the proposed tag is absent locally and remotely. Review the
notes for credentials, source content and unsupported acceptance claims.

## Publish only after target approval

The following commands are a manual publication procedure, not executed by this
documentation change. Replace `REVIEWED_FULL_COMMIT_HASH` only after the gates above:

```bash
git fetch origin main
git status --short
git show --stat REVIEWED_FULL_COMMIT_HASH
git merge-base --is-ancestor REVIEWED_FULL_COMMIT_HASH origin/main
git tag --list v0.1.0-alpha.1
git ls-remote --tags origin 'refs/tags/v0.1.0-alpha.1*'
git tag -a v0.1.0-alpha.1 REVIEWED_FULL_COMMIT_HASH -m 'ORQST v0.1.0-alpha.1 - experimental preview'
git show --no-patch v0.1.0-alpha.1
git push origin refs/tags/v0.1.0-alpha.1
git ls-remote --tags origin 'refs/tags/v0.1.0-alpha.1*'
```

Stop if a gate fails or the tag already exists. Push only the selected tag, never
all local tags. Verify that the remote annotated tag's peeled `^{}` hash is the
reviewed commit. Tagging never installs, restarts or upgrades a running ORQST.

If a GitHub Release is subsequently authorized, choose that existing tag, title it
`ORQST v0.1.0-alpha.1 — Experimental preview`, copy the reviewed version notes and
mark it **pre-release**, without designating it as latest stable. Publish source
only: GitHub's automatic source archives are not installers. There is no automatic
tag/release publication workflow in this preparation.
