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
deployment-time components used by this repository as of July 15, 2026.

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

## Direct Node.js Dependencies

### `services/nb-bond-api`

| Package | Version | License |
| --- | --- | --- |
| `@noble/secp256k1` | `3.1.0` | MIT |
| `better-sqlite3` | `12.11.1` | MIT |
| `cors` | `2.8.6` | MIT |
| `dotenv` | `17.4.2` | BSD-2-Clause |
| `ethers` | `6.17.0` | MIT |
| `express` | `5.2.1` | MIT |
| `express-rate-limit` | `8.5.2` | MIT |
| `helmet` | `8.2.0` | MIT |
| `jose` | `6.2.3` | MIT |
| `winston` | `3.19.0` | MIT |
| `zod` | `4.4.3` | MIT |
| `zod-openapi` | `6.0.0` | MIT |
| `@babel/core` | `7.29.7` | MIT |
| `@babel/preset-env` | `7.29.5` | MIT |
| `@eslint/js` | `10.0.1` | MIT |
| `@types/better-sqlite3` | `7.6.13` | MIT |
| `@types/cors` | `2.8.19` | MIT |
| `@types/express` | `5.0.6` | MIT |
| `@types/jest` | `30.0.0` | MIT |
| `@types/node` | `26.1.1` | MIT |
| `babel-jest` | `30.4.1` | MIT |
| `eslint` | `10.4.0` | MIT |
| `eslint-config-prettier` | `10.1.8` | MIT |
| `globals` | `17.7.0` | MIT |
| `jest` | `30.4.2` | MIT |
| `prettier` | `3.9.5` | MIT |
| `ts-jest` | `29.4.11` | MIT |
| `tsx` | `4.23.0` | MIT |
| `typescript` | `6.0.3` | Apache-2.0 |
| `typescript-eslint` | `8.63.0` | MIT |

### `scripts/bid-encryption`

| Package | Version | License |
| --- | --- | --- |
| `@noble/secp256k1` | `3.1.0` | MIT |
| `ethers` | `6.17.0` | MIT |
| `@types/node` | `26.1.1` | MIT |
| `tsx` | `4.23.0` | MIT |
| `typescript` | `6.0.3` | Apache-2.0 |

### `scripts/bid-submitter`

| Package | Version | License |
| --- | --- | --- |
| `@noble/secp256k1` | `3.1.0` | MIT |
| `ethers` | `6.17.0` | MIT |
| `@types/node` | `26.1.1` | MIT |
| `tsx` | `4.23.0` | MIT |
| `typescript` | `6.0.3` | Apache-2.0 |

### `services/nb-ui`

| Package | Version | License |
| --- | --- | --- |
| `@azure/msal-browser` | `5.16.0` | MIT |
| `react` | `19.2.7` | MIT |
| `react-dom` | `19.2.7` | MIT |
| `@testing-library/jest-dom` | `6.9.1` | MIT |
| `@testing-library/react` | `16.3.2` | MIT |
| `@testing-library/user-event` | `14.6.1` | MIT |
| `@vitejs/plugin-react` | `6.0.3` | MIT |
| `eslint` | `9.39.4` | MIT |
| `eslint-config-prettier` | `10.1.8` | MIT |
| `eslint-plugin-react` | `7.37.5` | MIT |
| `eslint-plugin-react-hooks` | `7.1.1` | MIT |
| `globals` | `17.7.0` | MIT |
| `jsdom` | `29.1.1` | MIT |
| `prettier` | `3.9.5` | MIT |
| `vite` | `8.0.16` | MIT |
| `vitest` | `4.1.10` | MIT |

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
| Blockscout Helm charts | GPL-3.0 | Pulled at deploy time |
| Blockscout application | GPL-3.0 | Pulled at deploy time |
| Blockscout smart-contract-verifier | GPL-3.0 | Contract-verification microservice; pulled at deploy time (pinned in `common/images.yaml` under `blockscout.smart_contract_verifier`) |
| BusyBox image | GPL-2.0 | Referenced in `services/blockscout/templates/blockscout-migration-job.yaml` |
