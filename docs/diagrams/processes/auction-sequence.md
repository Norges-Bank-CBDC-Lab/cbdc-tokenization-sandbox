# Sealed-Bid Auction Sequence

This is the current API and contract flow for RATE, PRICE, and BUYBACK
auctions. The operator chooses winning on-chain bid indexes; the API recomputes
the result over exactly that selection and refuses a clearing-rate mismatch.

```mermaid
sequenceDiagram
    autonumber
    actor Operator as Norges Bank operator
    participant UI as NB UI
    participant API as NB Bond API
    participant DB as SQLite projection / audit
    participant BM as BondManager
    participant BA as BondAuction
    participant BT as BondToken
    actor Bidder as Primary dealer
    participant DVP as BondDvP
    participant Cash as WNOK or government TBD

    Operator->>UI: Create bond or schedule auction
    UI->>API: POST /v1/bonds or POST /v1/bonds/{isin}/auctions

    alt New bond staged before auction
        API->>BM: deployBond(isin, maturityDuration)
        BM->>BT: createPartition(isin, 0, maturityDuration)
    end

    alt First RATE auction on unstaged bond
        API->>BM: deployBondWithAuction(..., sealingPublicKey)
        BM->>BT: createPartition + extend offering
    else RATE on staged bond, or later PRICE / BUYBACK
        API->>BM: deployAuctionForBond(..., auctionType)
        BM->>BT: extend offering for RATE/PRICE<br/>or validate supply for BUYBACK
    end
    BM->>BA: createAuction(...)
    BA-->>BM: auctionId<br/>status = BIDDING
    API->>DB: wait until receipt block is projected
    API-->>UI: Updated bond or HTTP 202 if projection is pending

    loop One or more bids
        Bidder->>Bidder: Build EIP-712 intent, sign,<br/>encrypt payload, dual-wrap symmetric key
        alt Sandbox bidder API
            Bidder->>API: POST /v1/bidders/{address}/bids
            API->>BA: submitBid(auctionId, ciphertext, plaintextHash)
        else Reference CLI / direct chain path
            Bidder->>BA: submitBid(auctionId, ciphertext, plaintextHash)
        end
        BA-->>Bidder: BidSubmitted event with bidIndex
    end

    Operator->>UI: Close after on-chain end time
    UI->>API: PATCH /v1/auctions/{auctionId} {status: closed}
    API->>BM: closeAuction(isin)
    BM->>BA: closeAuction(auctionId)
    BA-->>BM: status = CLOSED + sealed bids
    API->>DB: wait for projected close event
    API-->>UI: Closed auction with review data

    API->>BM: getSealedBids(isin)
    BM->>BA: getSealedBids(auctionId)
    BA-->>API: ciphertexts + commitments + bidder addresses
    API->>API: Unseal and validate bids
    UI-->>Operator: Display eligible bids and proposed result
    Operator->>UI: Select winning bid indexes and approve
    UI->>API: PUT /v1/auctions/{auctionId}/finalisation<br/>{winningBidIndexes, expectedClearingRate}
    API->>API: Recompute allocation over selection<br/>and cross-check clearing rate
    API->>BM: finaliseAuction(isin, allocations, proofs)
    BM->>BA: finaliseAuction(...)
    BA->>BA: Verify EIP-712 proof for each allocation<br/>consume bidder nonces, publish allocations

    alt RATE or PRICE issuance
        BM->>BT: mint allocated units to BondManager
        opt RATE only
            BM->>BT: set coupon yield and start maturity timer
        end
        loop Each allocation
            BM->>DVP: settle bond transfer + bidder WNOK payment
            DVP->>BT: transfer partition to bidder
            DVP->>Cash: transferFrom(bidder, government reserve)
        end
    else BUYBACK
        loop Each allocation
            BM->>DVP: settle bond burn + government TBD payment
            DVP->>BT: buybackRedeemFor(bidder)
            DVP->>Cash: transferFrom(government reserve, bidder)
        end
    end

    BM-->>API: Auction finalised<br/>per-allocation failures emitted
    API->>DB: Record operation and wait for receipt block projection
    API-->>UI: Final auction or HTTP 202 if projection is pending
```

Each `BondDvP.settle` call is atomic. Auction settlement as a whole is not:
`BondManager` catches a failed allocation, emits `BondAllocationFailed`, and
continues. A RATE/PRICE failure can therefore leave minted units in
`BondManager` for `withdrawFailedIssuance` while the auction remains
`FINALISED`.
