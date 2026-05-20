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

This file is a curated snapshot of direct dependencies and notable
deployment-time components used by this repository as of May 19, 2026.

It is not legal advice and it is not a complete transitive SBOM. For copied or
adapted files kept in-tree, generated code provenance, and related notes, see
`docs/THIRD_PARTY_NOTES.md`. For release artifacts, a generated dependency
inventory should still be preferred over hand-maintained documentation.

The direct dependency tables below are validated in CI with
`python3 scripts/verification/check-third-party-licenses.py`. That check verifies the
package/version inventory against the tracked `package.json`,
`package-lock.json`, `requirements.txt`, and `contracts/foundry.toml` files.
License labels and deployment-time notes remain curated review items.

## In-Tree Third-Party Material

| Path | Provenance | License |
| --- | --- | --- |
| `services/blockscout/bens-microservice/swagger/bens.swagger.yaml` | Copied from `blockscout/blockscout-rs` | MIT |
| `services/script-runner/templates/NOTES.txt` | Adapted from JupyterHub Helm chart `templates/NOTES.txt` | BSD-3-Clause / Apache-2.0 per retained provenance note |

## Direct Node.js Dependencies

### `services/nb-bond-api`

| Package | Version | License |
| --- | --- | --- |
| `@noble/secp256k1` | `3.1.0` | MIT |
| `better-sqlite3` | `12.10.0` | MIT |
| `cors` | `2.8.6` | MIT |
| `dotenv` | `17.4.2` | BSD-2-Clause |
| `ethers` | `6.16.0` | MIT |
| `express` | `5.2.1` | MIT |
| `helmet` | `8.1.0` | MIT |
| `winston` | `3.19.0` | MIT |
| `zod` | `4.4.3` | MIT |
| `zod-openapi` | `5.4.6` | MIT |
| `@babel/core` | `7.29.0` | MIT |
| `@babel/preset-env` | `7.29.5` | MIT |
| `@eslint/js` | `10.0.1` | MIT |
| `@types/better-sqlite3` | `7.6.13` | MIT |
| `@types/cors` | `2.8.19` | MIT |
| `@types/express` | `5.0.6` | MIT |
| `@types/jest` | `30.0.0` | MIT |
| `@types/node` | `24.12.4` | MIT |
| `babel-jest` | `30.4.1` | MIT |
| `eslint` | `10.4.0` | MIT |
| `eslint-config-prettier` | `10.1.8` | MIT |
| `globals` | `17.6.0` | MIT |
| `jest` | `30.4.2` | MIT |
| `prettier` | `3.8.3` | MIT |
| `ts-jest` | `29.4.10` | MIT |
| `tsx` | `4.22.3` | MIT |
| `typescript` | `6.0.3` | Apache-2.0 |
| `typescript-eslint` | `8.59.4` | MIT |

### `scripts/bid-encryption`

| Package | Version | License |
| --- | --- | --- |
| `@noble/secp256k1` | `3.1.0` | MIT |
| `ethers` | `6.16.0` | MIT |
| `@types/node` | `24.12.4` | MIT |
| `tsx` | `4.22.3` | MIT |
| `typescript` | `6.0.3` | Apache-2.0 |

### `scripts/bid-submitter`

| Package | Version | License |
| --- | --- | --- |
| `@noble/secp256k1` | `3.1.0` | MIT |
| `ethers` | `6.16.0` | MIT |
| `@types/node` | `24.12.4` | MIT |
| `tsx` | `4.22.3` | MIT |
| `typescript` | `6.0.3` | Apache-2.0 |

### `services/nb-ui`

| Package | Version | License |
| --- | --- | --- |
| `@azure/msal-browser` | `3.30.0` | MIT |
| `react` | `18.3.1` | MIT |
| `react-dom` | `18.3.1` | MIT |
| `@testing-library/jest-dom` | `6.7.0` | MIT |
| `@testing-library/react` | `16.3.2` | MIT |
| `@testing-library/user-event` | `14.5.2` | MIT |
| `@vitejs/plugin-react` | `4.7.0` | MIT |
| `eslint` | `9.18.0` | MIT |
| `eslint-config-prettier` | `10.1.8` | MIT |
| `eslint-plugin-react` | `7.37.4` | MIT |
| `eslint-plugin-react-hooks` | `5.1.0` | MIT |
| `globals` | `17.6.0` | MIT |
| `jsdom` | `26.0.0` | MIT |
| `prettier` | `3.8.3` | MIT |
| `vite` | `6.4.2` | MIT |
| `vitest` | `3.0.5` | MIT |

### `services/blockscout/bens-microservice`

`package.json` in this directory is local repository metadata for generated
output and does not declare third-party npm dependencies.

## Direct Python Dependencies

### `services/blockscout/bens-microservice`

| Package | Version | License |
| --- | --- | --- |
| `fastapi` | `0.136.1` | MIT |
| `uvicorn[standard]` | `0.47.0` | BSD-3-Clause |
| `asyncpg` | `0.31.0` | Apache-2.0 |
| `pydantic` | `2.13.4` | MIT |
| `typing-extensions` | `4.15.0` | PSF-2.0 |

### `services/script-runner/notebook`

| Package | Version | License |
| --- | --- | --- |
| `ipywidgets` | `8.1.8` | BSD-3-Clause |
| `web3` | `7.16.0` | MIT |
| `eth-account` | `0.13.7` | MIT |
| `ipython` | `9.13.0` | BSD-3-Clause |
| `pytz` | `2025.2` | MIT |
| `plotly` | `6.5.2` | MIT |
| `pandas` | `2.3.0` | BSD-3-Clause |
| `psycopg2-binary` | `2.9.12` | LGPL with exceptions |

## Direct Solidity Dependencies

| Package | Version | License |
| --- | --- | --- |
| `forge-std` | `1.16.1` | MIT |
| `@openzeppelin-contracts` | `5.4.0` | MIT |
| `@openzeppelin-contracts-upgradeable` | `5.4.0` | MIT |

## Deployment-Time Components

This repository is intended to publish source code only. The components below
are referenced by the sandbox, but they are not distributed or relicensed by
this source repository.

| Component | License | Notes |
| --- | --- | --- |
| Hyperledger Besu | Apache-2.0 | External runtime dependency |
| NGINX Gateway Fabric | Apache-2.0 | External runtime dependency |
| Docker Distribution Registry | Apache-2.0 | External local registry image |
| Node.js | MIT | External runtime image for NB Bond API |
| Python | PSF-2.0 | External runtime image for BENS |
| PostgreSQL | PostgreSQL License | External database image for Blockscout/BENS |
| JupyterHub Helm chart | BSD-3-Clause | External chart dependency |
| Jupyter Docker Stacks / `base-notebook` image | BSD-3-Clause | External image dependency |
| Blockscout Helm charts | GPL-3.0 | Pulled at deploy time |
| Blockscout application | GPL-3.0 | Pulled at deploy time |
| BusyBox image | GPL-2.0 | Referenced in `services/blockscout/templates/blockscout-migration-job.yaml` |
