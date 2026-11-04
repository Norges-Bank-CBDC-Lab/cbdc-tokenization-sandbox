# Third-Party Licenses

This repository consists of files licensed under Apache-2.0 unless explicitly
stated otherwise.

The repository may be used alongside third-party components that are not part of
this repository. Such components are not part of this repository, nor are they
licensed to you by us. If you choose to use any such third-party components, you
are solely responsible for complying with each component's corresponding
open-source license terms.

> ### Warning
> If you link (statically or dynamically) any code in this repository with
> components licensed under GPL-2.0 or GPL-3.0, the copyleft obligation may
> extend to the combined work, requiring that the entire resulting program - if
> distributed - be distributed under the applicable GPL license and that the
> source code be made available in accordance with its requirements. Similarly,
> if you statically link any code in this repository with components licensed
> under LGPL, the copyleft obligation may equally extend to the combined work,
> imposing the same distribution and source code requirements on the resulting
> program. These are provided as examples only and do not constitute legal
> advice. You are solely responsible for analyzing all implications of
> incorporating third-party components under their respective open-source
> license terms.

## Third-Party License Inventory

This file is a curated list of direct dependencies and notable deployment-time
components used by this repository, with their licenses. It deliberately does
not list versions: those live in the manifests and the lockfile, so a version
bump does not need an edit here.

It is not legal advice and it is not a complete transitive SBOM. For copied or
adapted files kept in-tree, generated code provenance, and related notes, see
`docs/THIRD_PARTY_NOTES.md`. For release artifacts, a generated dependency
inventory should still be preferred over hand-maintained documentation.

The direct dependency tables below are validated in CI with
`python3 scripts/verification/check-third-party-licenses.py`. That check verifies
that:

- each direct dependency in the tracked `package.json`, `requirements.txt`, and
  `contracts/foundry.toml` files has exactly one row, so adding or removing a
  dependency means editing this file;
- each npm row carries the license recorded in `package-lock.json`, so a bump
  that changes a package's license fails until the row is reviewed;
- direct npm dependencies are exact versions, with no range operators;
- every license in the lockfile and in the tables is on a permissive allowlist
  (Apache-2.0, MIT, MIT-0, ISC, BSD-2-Clause, BSD-3-Clause, 0BSD, BlueOak-1.0.0,
  CC0-1.0, PSF-2.0, Unlicense, Zlib) or is covered by a row under "Approved
  License Exceptions".

Python and Solidity license labels are curated by hand, and deployment-time
notes remain curated review items.

## In-Tree Third-Party Material

| Path | Provenance | License |
| --- | --- | --- |
| `services/blockscout/bens-microservice/swagger/bens.swagger.yaml` | Copied from `blockscout/blockscout-rs` | MIT |

## Direct Node.js Dependencies

### `services/nb-bond-api`

| Package | License |
| --- | --- |
| `@noble/secp256k1` | MIT |
| `better-sqlite3` | MIT |
| `cors` | MIT |
| `dotenv` | BSD-2-Clause |
| `ethers` | MIT |
| `express` | MIT |
| `express-rate-limit` | MIT |
| `helmet` | MIT |
| `jose` | MIT |
| `winston` | MIT |
| `zod` | MIT |
| `zod-openapi` | MIT |
| `@babel/core` | MIT |
| `@babel/preset-env` | MIT |
| `@eslint/js` | MIT |
| `@types/better-sqlite3` | MIT |
| `@types/cors` | MIT |
| `@types/express` | MIT |
| `@types/jest` | MIT |
| `@types/node` | MIT |
| `babel-jest` | MIT |
| `eslint` | MIT |
| `eslint-config-prettier` | MIT |
| `globals` | MIT |
| `jest` | MIT |
| `prettier` | MIT |
| `tsx` | MIT |
| `typescript` | Apache-2.0 |
| `typescript-eslint` | MIT |

### `scripts/bid-encryption`

| Package | License |
| --- | --- |
| `@noble/secp256k1` | MIT |
| `ethers` | MIT |
| `@types/node` | MIT |
| `tsx` | MIT |
| `typescript` | Apache-2.0 |

### `scripts/bid-submitter`

| Package | License |
| --- | --- |
| `@noble/secp256k1` | MIT |
| `ethers` | MIT |
| `@types/node` | MIT |
| `tsx` | MIT |
| `typescript` | Apache-2.0 |

### `services/nb-ui`

| Package | License |
| --- | --- |
| `@azure/msal-browser` | MIT |
| `react` | MIT |
| `react-dom` | MIT |
| `@testing-library/jest-dom` | MIT |
| `@testing-library/react` | MIT |
| `@testing-library/user-event` | MIT |
| `@vitejs/plugin-react` | MIT |
| `eslint` | MIT |
| `eslint-config-prettier` | MIT |
| `eslint-plugin-react` | MIT |
| `eslint-plugin-react-hooks` | MIT |
| `globals` | MIT |
| `jsdom` | MIT |
| `prettier` | MIT |
| `vite` | MIT |
| `vitest` | MIT |

### `services/blockscout/bens-microservice`

`package.json` in this directory is local repository metadata for generated
output and does not declare third-party npm dependencies.

## Direct Python Dependencies

### `services/blockscout/bens-microservice`

| Package | License |
| --- | --- |
| `fastapi` | MIT |
| `uvicorn[standard]` | BSD-3-Clause |
| `asyncpg` | Apache-2.0 |
| `pydantic` | MIT |
| `typing-extensions` | PSF-2.0 |

## Direct Solidity Dependencies

| Package | License |
| --- | --- |
| `forge-std` | MIT |
| `@openzeppelin-contracts` | MIT |
| `@openzeppelin-contracts-upgradeable` | MIT |

## Approved License Exceptions

Licenses outside the allowlist described above. Adding a row needs the
operator's explicit, double confirmation. `Package` is an exact name or a
prefix pattern ending in `*`. Scope `dev` means the lockfile must mark the
package as development-only; the check fails if it becomes a runtime
dependency. A row that matches nothing is reported as stale.

| Package | License | Scope | Reason |
| --- | --- | --- | --- |
| `lightningcss*` | MPL-2.0 | dev | File-level copyleft; installed for Vite (UI build tooling), development-only in the lockfile |
| `argparse` | Python-2.0 | dev | Permissive PSF-style terms; dependency of `js-yaml`, development-only in the lockfile |
| `caniuse-lite` | CC-BY-4.0 | dev | Browser-support data read by `browserslist`; attribution-only terms, development-only in the lockfile |

## Deployment-Time Components

This repository is intended to publish source code only. The components below
are referenced by the sandbox, but they are not distributed or relicensed by
this source repository.

| Component | License | Notes |
| --- | --- | --- |
| Hyperledger Besu | Apache-2.0 | External runtime dependency |
| NGINX Gateway Fabric | Apache-2.0 | External runtime dependency |
| Docker Distribution Registry | Apache-2.0 | External local registry image |
| Node.js | MIT | External image for the NB Bond API runtime and the NB UI build stage (pinned in `common/node-version.env`) |
| Python | PSF-2.0 | External runtime image for BENS |
| `nginxinc/nginx-unprivileged` | BSD-2-Clause | Runtime stage of the NB UI image (pinned in `common/images.yaml` under `nb_ui.nginx`) |
| PostgreSQL | PostgreSQL License | External database image for Blockscout/BENS |
| Blockscout Helm charts | GPL-3.0 | Pulled at deploy time |
| Blockscout application | GPL-3.0 | Built locally from pinned upstream source tags (`./sandbox.sh build-images`); upstream no longer publishes release images. The backend image (v12 and later) also contains Alpine's `ffmpeg` (GPL-2.0-or-later AND LGPL-2.1-or-later), built and run locally and not redistributed |
| Blockscout smart-contract-verifier | GPL-3.0 | Contract-verification microservice; pulled at deploy time (pinned in `common/images.yaml` under `blockscout.smart_contract_verifier`) |
| BusyBox image | GPL-2.0 | Referenced in `services/blockscout/templates/blockscout-migration-job.yaml` |
