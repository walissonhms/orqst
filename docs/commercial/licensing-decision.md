# Community Edition licensing

## Decision

The owner approved **Apache-2.0** on 2026-11-02. The complete, unmodified license
text is in [LICENSE](../../LICENSE), downloaded from the
[Apache Software Foundation](https://www.apache.org/licenses/LICENSE-2.0.txt).
[NOTICE](../../NOTICE) identifies the project. Every workspace manifest declares
`"license": "Apache-2.0"` and remains `private: true` to prevent accidental npm
publication. A private package manifest does not restrict the source license.

## Scope and rationale

Apache-2.0 applies to the original ORQST Community Edition code and documentation,
including the observability core, shared protocol and provider adapters. Third-party
components retain their own terms.

The permissive license supports self-hosting, commercial use, proprietary
integrations and a future commercial Cloud service. It includes an express patent
grant limited to the contributor claims described in section 3. It also permits
competitors to host modified closed versions; there is no network copyleft
requirement. Trademark rights are not granted by the license.

Future independently developed Cloud modules may have separate proprietary terms.
No Cloud implementation is included in this repository, and the Community Edition
must continue to operate without an account or Cloud dependency.

Tucano was used only as an architectural reference. No Tucano code, assets or
schemas were incorporated into ORQST; its Apache-2.0 license did not determine
ORQST's license choice. Any future reuse requires a component-specific review and
preservation of applicable notices.

## Contributions and source headers

Contributions intentionally submitted for inclusion are governed by Apache-2.0
section 5 unless explicitly stated otherwise. Different submission terms require
agreement before merging. This repository does not require a separate CLA or DCO.
See [CONTRIBUTING.md](../../CONTRIBUTING.md).

Existing files do not require a new per-file header in this change. Preserve
existing third-party copyright and attribution notices; do not replace them with
ORQST notices. License changes require explicit owner approval.

## Third-party review and distribution

An installed-dependency metadata inventory was reviewed on 2026-11-02 with
`pnpm licenses list --json` and `pnpm licenses list --prod --json` after
`pnpm install --frozen-lockfile`. The combined development/runtime inventory
reported MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0 and BlueOak-1.0.0.
No unknown license category was reported. The build dependency lightningcss uses
MPL-2.0; its files are not relicensed as Apache-2.0. The inventory is a local
metadata check, not a certification of every dependency's contents or license.

Runtime JavaScript dependencies and the React dashboard include MIT and ISC
components whose copyright and license notices must be retained. The installed
TypeScript packages also carry Apache-2.0 notices. Development tools such as
Playwright and Prettier contain additional notice files. Installing dependencies
preserves their packaged license files; those files must not be omitted when the
corresponding components are redistributed.

The repository distributes source and the pnpm lockfile, not `node_modules`,
compiled bundles, binaries or the private Node/pnpm toolchain. Before publishing a
compiled dashboard, installer or binary, inspect the exact included components and
carry their full required license and attribution texts with that artifact. Node,
pnpm and browser binaries have their own third-party notices. Recheck the inventory
when dependencies or distribution formats change.

No package publication, release tag or proprietary Cloud license is authorized by
this licensing decision alone.
