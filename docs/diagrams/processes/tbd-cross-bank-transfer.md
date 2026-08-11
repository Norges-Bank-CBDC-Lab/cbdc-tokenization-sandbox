# TBD Cross-Bank Transfer

TBD is a liability of one bank. An inter-bank customer payment burns the
sender-bank deposit, moves WNOK reserves between banks, and mints an equal
deposit at the receiving bank through the ERC-1363 callback path.

```mermaid
sequenceDiagram
    autonumber
    participant Caller as DvP / authorised CCT caller
    actor Payer
    participant BuyerTBD as Sender-bank TBD
    participant WNOK as WNOK
    participant SellerTBD as Receiver-bank TBD
    participant BuyerBank as Sender bank reserve address
    participant SellerBank as Receiver bank reserve address
    actor Payee

    Caller->>BuyerTBD: cctFrom(payer, payee, receiverTbd, value)

    alt Same TBD contract
        BuyerTBD->>BuyerTBD: transfer(payer, payee, value)<br/>with allowlist checks
        BuyerTBD-->>Payee: Deposit balance transferred
    else Different bank TBD contracts
        BuyerTBD->>BuyerTBD: burn payer deposit value
        BuyerTBD->>SellerTBD: cctSetToAddr(payee)
        BuyerTBD->>WNOK: transferFromAndCall(sender bank, receiver TBD, value)
        WNOK->>WNOK: transferFrom(sender bank, receiver TBD, value)
        WNOK->>SellerTBD: onTransferReceived(operator=BuyerTBD, value)
        SellerTBD->>SellerTBD: Resolve payee registered for BuyerTBD<br/>and require payee allowlisted
        SellerTBD->>SellerTBD: mint payee deposit value
        SellerTBD->>WNOK: transfer(receiver bank, value)
        WNOK-->>SellerBank: Receiver bank reserve increases
        BuyerBank-->>BuyerBank: Sender bank reserve decreased
        SellerTBD-->>Payee: Receiver-bank deposit minted
    end
```

All calls execute in one EVM transaction. Any allowlist, balance, role,
allowance, or callback failure reverts the burn, reserve movement, and mint.
