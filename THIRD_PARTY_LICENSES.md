# Third-Party License Inventory

This file is a curated snapshot of direct dependencies and notable
deployment-time components used by this repository as of March 16, 2026.

It is not legal advice and it is not a complete transitive SBOM. For copied or
adapted files kept in-tree, see `THIRD_PARTY.md`. For release artifacts, a
generated dependency inventory should still be preferred over hand-maintained
documentation.

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
| `@noble/secp256k1` | `3.0.0` | MIT |
| `better-sqlite3` | `12.8.0` | MIT |
| `dotenv` | `17.3.1` | BSD-2-Clause |
| `ethers` | `6.16.0` | MIT |
| `express` | `5.2.1` | MIT |
| `helmet` | `8.1.0` | MIT |
| `winston` | `3.19.0` | MIT |
| `zod` | `4.3.6` | MIT |
| `zod-openapi` | `5.4.6` | MIT |
| `@babel/core` | `7.29.0` | MIT |
| `@babel/preset-env` | `7.29.2` | MIT |
| `@eslint/js` | `10.0.1` | MIT |
| `@types/better-sqlite3` | `7.6.13` | MIT |
| `@types/express` | `5.0.6` | MIT |
| `@types/jest` | `30.0.0` | MIT |
| `@types/node` | `25.5.0` | MIT |
| `babel-jest` | `30.3.0` | MIT |
| `eslint` | `10.0.3` | MIT |
| `eslint-config-prettier` | `10.1.8` | MIT |
| `jest` | `30.3.0` | MIT |
| `prettier` | `3.8.1` | MIT |
| `ts-jest` | `29.4.6` | MIT |
| `tsx` | `4.21.0` | MIT |
| `typescript` | `5.9.3` | Apache-2.0 |
| `typescript-eslint` | `8.57.1` | MIT |

### `scripts/bid-encryption`

| Package | Version | License |
| --- | --- | --- |
| `@noble/secp256k1` | `3.0.0` | MIT |
| `ethers` | `6.16.0` | MIT |
| `@types/node` | `25.5.0` | MIT |
| `tsx` | `4.21.0` | MIT |
| `typescript` | `5.9.3` | Apache-2.0 |

### `scripts/bid-submitter`

| Package | Version | License |
| --- | --- | --- |
| `@noble/secp256k1` | `3.0.0` | MIT |
| `ethers` | `6.16.0` | MIT |
| `@types/node` | `25.5.0` | MIT |
| `tsx` | `4.21.0` | MIT |
| `typescript` | `5.9.3` | Apache-2.0 |

### `services/blockscout/bens-microservice`

`package.json` in this directory is local repository metadata for generated
output and does not declare third-party npm dependencies.

## Direct Python Dependencies

### `services/blockscout/bens-microservice`

| Package | Version | License |
| --- | --- | --- |
| `fastapi` | `0.128.5` | MIT |
| `uvicorn[standard]` | `0.40.0` | BSD-3-Clause |
| `asyncpg` | `0.30.0` | Apache-2.0 |
| `pydantic` | `2.12.0` | MIT |
| `typing-extensions` | `4.15.0` | PSF-2.0 |

### `services/script-runner/notebook`

| Package | Version | License |
| --- | --- | --- |
| `ipywidgets` | `8.1.8` | BSD-3-Clause |
| `web3` | `7.14.1` | MIT |
| `eth-account` | `0.13.7` | MIT |
| `ipython` | `9.10.0` | BSD-3-Clause |
| `pytz` | `2025.2` | MIT |
| `plotly` | `6.5.2` | MIT |
| `pandas` | `2.3.0` | BSD-3-Clause |
| `psycopg2-binary` | `2.9.11` | LGPL with exceptions |

## Direct Solidity Dependencies

| Package | Version | License |
| --- | --- | --- |
| `forge-std` | `1.15.0` | MIT |
| `@openzeppelin-contracts` | `5.3.0` | MIT |
| `@openzeppelin-contracts-upgradeable` | `5.3.0` | MIT |

## Deployment-Time Components

This repository is intended to publish source code only. The components below
are referenced, pulled, or deployed by the sandbox, but they are not
distributed or relicensed by this source repository.

| Component | License | Notes |
| --- | --- | --- |
| Hyperledger Besu | Apache-2.0 | External runtime dependency |
| NGINX Gateway Fabric | Apache-2.0 | External runtime dependency |
| JupyterHub Helm chart | BSD-3-Clause | External chart dependency |
| Jupyter Docker Stacks / `base-notebook` image | BSD-3-Clause | External image dependency |
| Blockscout Helm charts | GPL-3.0 | Pulled at deploy time |
| Blockscout application | GPL-3.0 | Pulled at deploy time |
| BusyBox image | GPL-2.0 | Referenced in `services/blockscout/templates/blockscout-migration-job.yaml` |

## Notable Caveats

- `psycopg2-binary` is more restrictive than Apache-2.0. If you distribute
  images or environments that include it in the future, additional compliance
  obligations may apply.
- `caniuse-lite` appears as a transitive dev dependency in
  `services/nb-bond-api/package-lock.json` and is labeled `CC-BY-4.0` in npm
  metadata.
- Third-party deployment-time software keeps its upstream license terms even
  when this repository is Apache-2.0.
