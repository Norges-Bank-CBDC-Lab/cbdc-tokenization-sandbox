# Documentation refresh — Intent

**Status:** Draft
**Created:** 2026-09-28
**Requested by:** sandbox operator

## Outcome

A reader of the public repository finds documentation that matches what the code does today and
that follows the repository's own publication rules: no cloud-deployment specifics outside the
accepted surfaces, no names of local-only agent tooling, active plans that are actually active,
no behaviour described that was removed months ago, a known-issues list without resolved items,
contract reference pages whose source links resolve, and a license inventory that lists every
image the sandbox builds on.

## Why This Change

A read-only review on 2026-09-28 found documentation drift that predates every plan written that
day. Each item is small, but together they mislead: operators are told to run a script that never
existed, reviewers see an API route and a contract function that were removed, the generated
contract reference links to a commit that is not on GitHub, and several committed files name the
tooling or the cloud platform the operator deliberately keeps out of the public tree. The
cloud-wording items break a hard publication rule, so they come first.

## Scope

### In Scope

Pre-existing drift only, where a document describes behaviour that has already changed:

1. **Cloud wording (D1).** Committed docs, Helm example values, source comments, and the
   generated `services/nb-bond-api/openapi.json` that name the cloud platform, its managed
   Kubernetes service, the GitOps controller, or the infrastructure-as-code tool. Replace them
   with environment-neutral wording ("non-local deployment", "the deployment"). Accepted
   surfaces stay: the `entra` auth mode in `services/nb-ui` and `services/nb-bond-api` (including
   its npm package identifier), and existing text in `docs/AZURE_BOUNDARY.md`.
2. **Local tooling names (D2).** Active committed docs that name local agent tooling.
3. **Plan housekeeping (D3–D5).** Archive the superseded ERC-3643 incremental plan; add one
   convention line to `docs/plans/README.md` about ADR plan pointers; park the closed-loop
   settlement plan with a drift note; fix the branch-suggestion lines in the two 2026-07-15
   plans.
4. **Removed behaviour still documented (D6).** The reopen-auction known issue, failed-issuance
   withdrawal, the `BOND_MANAGER_ROLE` row, the redeem route in a component diagram, removed
   gateway ports, a holders endpoint that does not exist, a BENS script that never existed, the
   services structure list, the startup flowchart's resume step, the diagram index wording, stale
   link labels, and the bond status classifier diagram.
5. **Known issues (D7).** Remove the resolved ingestion entry; correct the sample ethers version;
   add the two BENS follow-ups recorded only in an archived plan; add the bond transfer
   eligibility gap unless the bond coupon and maturity correctness plan adopts its fix.
6. **Generated NatSpec links (D8).** Every "Git Source" link in `contracts/docs/natspec/` 404s.
7. **License inventory and entrypoints (D9).** Snapshot date, the Blockscout application row,
   the missing NB UI runtime image row, the README agent-guidance list, the CONTRIBUTING check
   list, and the ADR 0001 index entry.

### Out of Scope

- Frozen records: numbered ADRs, archived plans, post-mortems. Drift in them is reported in
  `design.md`; only status lines may change, and only with operator approval.
- Documentation that other plans written on 2026-09-28 update as they land:
  `bond-coupon-maturity-correctness`, `ingestion-projection-correctness`,
  `nb-bond-api-hardening`, `nb-ui-correctness-and-hardening` (owns the nb-ui `AGENTS.md`,
  `DEVELOPMENT.md`, and `config.js` doc fixes other than the cloud wording in D1), and
  `sandbox-scripts-and-ci-hardening` (owns README, Makefile, and script-comment fixes tied to its
  script changes). `design.md` lists the exact boundaries.
- Index entries for the plan folders written on 2026-09-28; the operator adds them when
  committing those folders.
- Any behaviour change, new CI check, or new dependency.

## Acceptance Criteria

| Criterion | Risk addressed | Verification evidence |
|---|---|---|
| The operator's cloud-term self-check over tracked files, excluding frozen records, returns only accepted surfaces | Hard publication rule broken | Self-check output recorded in `progress.md` (counts only) |
| `openapi.json` differs from `development` only in the five `testMode` description strings | Unintended API contract change | `npm run regen:openapi -w nb-bond-api`; `git diff --stat` |
| No active committed doc names local agent tooling | Committed text rule | grep for tooling names outside frozen records returns nothing |
| `docs/plans/` holds only plans that are Proposed, Approved, or In progress; the superseded plan is under `archive/` and indexed there | Plan tree misleads | `ls docs/plans`; index entry |
| No active doc describes `reopenAuction`, failed-issuance withdrawal, the redeem route, the holders endpoint, ports 443/8546, or the BENS start script | Operators follow removed paths | grep in the verification stop of Phase 3 |
| Bond status diagram matches `bondStatus` in `compose-projection.ts` | Diagram contradicts code | Side-by-side review |
| `docs/KNOWN_ISSUES.md` has no resolved entries and records the BENS follow-ups | Stale and missing issues | Review of the diff |
| Every "Git Source" link in the NatSpec pages resolves and is checked by the link checker | 404 links nobody notices | `check-markdown-links.py` passes with relative links |
| `THIRD_PARTY_LICENSES.md` lists every pinned runtime image, and its date matches the last row change | Inventory incomplete | Row review against `common/images.yaml`; license check passes |
| Hygiene and markdown-link checks pass on every slice | Broken links, leaked identifiers | CI `validate-publication-hygiene` |

## Constraints

- Sandbox-sized; documentation and comment changes only, plus one generated file and one
  post-processing script.
- Public repo: no secrets, private identifiers, home-directory paths, tooling names, or
  cloud-deployment specifics in any committed text, including this plan.
- Frozen records change only on their status line, with operator approval.

## Open Questions

- Whether the title of `docs/AZURE_BOUNDARY.md`, which names the cloud platform and the GitOps
  tool, is within its established generic scope. It is existing text and stays as is unless the
  operator decides otherwise. Owner: operator.
- Keep or park the two 2026-07-15 plans (wallet, entity directory). Owner: operator.
