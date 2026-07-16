# Bid Cryptography Flow

The auction contract stores encrypted bids plus a plaintext commitment. Bid
contents are disclosed to the API only after off-chain unsealing; finalisation
proves that every allocated bidder signed the submitted bid intent.

```mermaid
flowchart TD
    terms["Plaintext bid<br/>ISIN, units, rate/price, bidder nonce"]
    hash["plaintextHash = keccak256(canonical plaintext)"]
    intent["EIP-712 BidIntent<br/>bidder, auctionId, plaintextHash, bidderNonce"]
    sig["Bidder signs intent"]
    payload["Plaintext + bidder signature"]
    symKey["Random symmetric key"]
    encrypt["AES-256-GCM encrypt plaintext once"]
    bidderWrap["Wrap symmetric key for bidder<br/>secp256k1 ECDH + AES-GCM"]
    auctioneerWrap["Wrap symmetric key for auctioneer<br/>secp256k1 ECDH + AES-GCM"]
    pack["Pack version, both key wraps,<br/>nonce, tag, and ciphertext"]
    submit["submitBid(auctionId, ciphertext, plaintextHash)"]
    stored["BondAuction stores<br/>bidder, ciphertext, plaintextHash, bidIndex"]
    close["Auction CLOSED"]
    unseal["API unseals with auctioneer private key"]
    commit{"API validates hash, ISIN,<br/>stored submitter, and signature presence?"}
    select["Operator selects winning bid indexes"]
    allocate["API recomputes uniform allocation<br/>and expected clearing rate"]
    proof["Build BidVerification<br/>bidIndex, bidderNonce, bidderSig"]
    verify{"Contract verifies EIP-712 signer over<br/>stored commitment and unused nonce"}
    final["Publish allocations and settle"]
    reject(["Reject bid or finalisation"])

    terms --> hash
    terms --> intent
    hash --> intent
    intent --> sig
    sig --> payload
    terms --> payload
    payload --> encrypt
    symKey --> encrypt
    symKey --> bidderWrap
    symKey --> auctioneerWrap
    encrypt --> pack
    bidderWrap --> pack
    auctioneerWrap --> pack
    pack --> submit --> stored
    stored --> close --> unseal --> commit
    commit -->|"no"| reject
    commit -->|"yes"| select --> allocate --> proof --> verify
    verify -->|"no"| reject
    verify -->|"yes"| final
```

The auctioneer sealing private key is operationally critical: losing or
rotating it while an auction is open makes those stored ciphertexts unusable.
