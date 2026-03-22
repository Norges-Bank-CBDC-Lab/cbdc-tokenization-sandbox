#!/bin/bash

# start anvil with gas fees set to zero
# deterministic contract addresses with fifo
anvil \
    --base-fee 0 \
    --gas-price 0 \
    --accounts 20 \
    --order fifo \
    --block-time 2
