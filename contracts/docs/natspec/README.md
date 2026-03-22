# Generated NatSpec Reference

This folder contains the generated NatSpec contract reference for
[`contracts/src/`](../../src).

Start with [`src/README.md`](./src/README.md), which is the generated index for
the contract tree.

Regenerate the reference from `contracts/` with:

```console
forge doc --out docs/natspec
python3 docs/natspec/fix-links.py
```

Notes:

- The generated Markdown is intended to be committed alongside the source so it
  is browsable in the repository.
- `forge doc` currently emits root-relative links such as `/src/...` that do
  not browse correctly from the committed `docs/natspec/` tree. Run
  `python3 docs/natspec/fix-links.py` after regeneration to rewrite those links
  for repository browsing.
- The generated `Git Source` links embed the current commit hash at generation
  time, so rerun `forge doc --out docs/natspec` after source or NatSpec comment
  changes and before cutting a release or finalising a commit that updates the
  contracts.
- `book/` output is intentionally ignored; generate it locally only when you
  need a built site.
