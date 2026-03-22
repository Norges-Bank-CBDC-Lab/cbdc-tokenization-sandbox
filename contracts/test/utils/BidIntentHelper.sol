// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";

/// @notice Utility helper for building and signing BidIntent EIP-712 digests in tests.
contract BidIntentHelper is Test {
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant BID_INTENT_TYPEHASH =
        keccak256("BidIntent(address bidder,bytes32 auctionId,bytes32 plaintextHash,uint256 bidderNonce)");
    bytes32 internal constant NAME_HASH = keccak256(bytes("BondAuctionBid"));
    bytes32 internal constant VERSION_HASH = keccak256(bytes("1"));

    function makeBidder(string memory label) public returns (address bidder, uint256 bidderPrivateKey) {
        (bidder, bidderPrivateKey) = makeAddrAndKey(label);
    }

    function bidIntentDigest(
        address bidder,
        bytes32 auctionId,
        bytes32 plaintextHash,
        uint256 bidderNonce,
        address verifyingContract,
        uint256 chainId
    ) public pure returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, chainId, verifyingContract)
        );
        bytes32 structHash = keccak256(abi.encode(BID_INTENT_TYPEHASH, bidder, auctionId, plaintextHash, bidderNonce));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function signBidIntent(
        uint256 bidderPrivateKey,
        address bidder,
        bytes32 auctionId,
        bytes32 plaintextHash,
        uint256 bidderNonce,
        address verifyingContract,
        uint256 chainId
    ) public pure returns (bytes memory) {
        bytes32 digest = bidIntentDigest(bidder, auctionId, plaintextHash, bidderNonce, verifyingContract, chainId);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(bidderPrivateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
