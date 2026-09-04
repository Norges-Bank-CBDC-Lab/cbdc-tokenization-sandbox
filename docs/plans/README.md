# Implementation plans

`docs/plans/` holds forward-looking implementation plans. A plan is a living, multi-phase
document that says how a change will be built and proven; the *why* behind a load-bearing
decision belongs in an ADR under `docs/decisions/`, and the current state of the system belongs
in `docs/ARCHITECTURE.md`.

## Layout for new plans

Every new plan is a folder, `docs/plans/<kebab-case-name>/`, with four files that are written in
order and read in order:

| File | Answers | Written when |
|---|---|---|
| `intent.md` | What outcome is wanted, for whom, what is in and out of scope, and how success is judged | First, before any design work; short enough to agree on in one review |
| `design.md` | What the target architecture is, the evidence it rests on, the options rejected and why, the invariants to preserve | Once the intent is agreed |
| `plan.md` | The dependency-ordered phases, each with steps, verification, recovery, and exit criteria, plus the test matrix and PR slices | Once the design is agreed |
| `progress.md` | Where the work stands: which phases are done, what was verified, what changed from the plan, what is next | Updated in the same commit as each phase's work, and at the end of every working session |

The folder is the unit of resumption: a contributor picking the work up later reads the four
files and continues from `progress.md` without needing the conversation, ticket, or session
that produced them. `progress.md` is therefore committed, not kept locally.

Conventions:

- The `Status:` line at the top of `plan.md` is the plan's status (`Proposed`, `Approved`,
  `In progress`, `Implemented`, `Superseded`). `progress.md` records the per-phase detail.
- Link the plan's load-bearing decision to its ADR and link back from the ADR.
- Reference the folder from `docs/DOCUMENTATION_INDEX.md` with a one-line summary.
- When the plan ships or is superseded, move the whole folder to `docs/plans/archive/`, update
  the `Status:` line, and update the index. Archived folders are frozen records.
- Plans are public: no secrets, no private infrastructure identifiers, no absolute
  home-directory paths, no references to local-only tooling.

## Existing single-file plans

Plans created before this layout are single files, `docs/plans/<name>-plan.md`, and stay that
way; they are not converted. Their status line and archive rule are the same as above.
