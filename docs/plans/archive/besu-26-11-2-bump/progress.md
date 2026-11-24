# Besu 26.11.2 bump — Progress

**Plan:** [`plan.md`](plan.md)

## Phase Log

| Phase | State | Notes |
|---|---|---|
| Evidence | Done (2026-11-24) | Release notes for 26.11.1 and 26.11.2, registry manifests, repository search, image read, a read-only live baseline |
| 1 Pin sweep | Done (2026-11-24) | Eight files plus the Known Issues and index edits; the baseline, image-pin, image-hash, hygiene, link, licence and node-version checks pass; the only `26.11.0` left outside frozen records is the register and rollback wording |
| 2 Trust-store register | Done (2026-11-24) | The 26.11.2 image carries Temurin 25.0.5.1 on Ubuntu 24.04.5 with 116 certificates and none of the emSign or AAA roots; the Besu row is refreshed |
| 3 Live upgrade | Done (2026-11-24) | In-place Helm upgrade on the existing chain; every acceptance row has evidence below |
| 4 PR | In progress | Folder archived in the change commit; merge pending the operator's go-ahead |

## Deviations From Plan

- The fresh-genesis run was not done: nothing in the in-place checks looked wrong.
- The plan's single start command was `./infra/infra.sh start` (Kind, gateway, Besu), run after
  `registry-sync`, from the checkout that holds the gitignored local fixtures.

## Verified Claims

Image: `hyperledger/besu:26.11.2` index digest `sha256:19d6cf7fffda207c814778b301b9d4eb8f6f2d7acaad7e4ca4a974784b4f8554`, re-read from the registry before the pin edit. The image has Temurin 25.0.5.1,
`keytool` and `java` but no `jcmd`, `jstack`, `jmap` or `jshell`, 116 trust-store entries with none of the emSign or AAA roots,
and `-XX:-UseBASE64Intrinsics` in the launcher's default JVM options.

Baseline before the upgrade: both nodes `besu/v26.11.0` on chain 2018, head 1843 (block 0x733, hash
`0xd25cdfa5...a83cb`, state root `0xb07593a0...d0c99`), NB Bond API healthy at lag 0, Blockscout at 1843.

After the upgrade:

- Both nodes report `besu/v26.11.2` on fresh pods. Block 0x733 has the identical hash and state root,
  so the chain was upgraded in place with no wipe and no redeployment.
- Three zero-fee self-transfers mined in blocks 1845 to 1847 (status 1). Both nodes report identical
  block hashes and state roots for each. NB Bond API stayed at lag 0 and Blockscout matched the head.
- Bond lifecycle on the upgraded chain (a new bond, a RATE auction, two sealed bids, close,
  finalisation, two coupon payments): the bond reached `matured` with total supply 0. The history
  shows `BOND_CREATED`, `RATE`, `CLOSED`, `ISSUANCE_COMPLETE`, `FINALISED`, then the coupon and
  `REDEEMED` events and `MATURED`. The chain only advances its clock when a block is mined, so the
  second coupon became payable once the soak's transactions mined blocks.
- Each node was restarted once (archive, then validator); both came back ready within about 15
  seconds, with no `ERROR` lines. The `WARN` lines are startup configuration notices (unused
  WebSocket and GraphQL host flags, zero-gas-price settings, no system contract addresses).
  Both nodes were at the same head and hash after the restarts.
- `trace_block` against the archive node returned its two traces for a block with one transaction.
- Soak, 20 minutes (10:16 to 10:37 UTC) with a zero-fee transaction every 15 seconds: 11 samples every
  two minutes compared a block two behind the head on both nodes; every hash and state root matched.
  NB Bond API lag was 0 or 1, Blockscout followed the head, and neither pod restarted on its own.
  The archive node logged `eth_getBlockByNumber ... Connection closed before JSON-RPC response could
  be written` about every 17 seconds, the cadence of the transaction trickle; the sending tool closes
  its connection after a receipt, so this is a client artefact, not a node fault. Of 71 send attempts
  from the trickle, 69 mined; two returned no receipt (one around the archive-node restart) and
  the account's nonce stayed consistent.
- Blockscout logged "shutting down WS client" at each node restart (no WebSocket fallback is
  configured), as on previous bumps; blocks kept importing.

Final state: head 1927, both nodes on the same hash and state root, NB Bond API lag 0, Blockscout at 1927.

## Follow-ups

- Blockscout shuts its WebSocket client down when the archive node restarts and has no fallback
  configured; blocks still import. Existing behaviour, not changed here.
- The downgrade guard (26.11.0 refusing data last started by 26.11.2) is recorded from a separate
  test and was not exercised on this stack.
- PostgreSQL 18.7 is the remaining pin not taken.

## Session Handoff

Change committed on `feature/besu-26-11-2`. The local stack already runs 26.11.2. Next: PR against
`development`, merge on the operator's go-ahead.
