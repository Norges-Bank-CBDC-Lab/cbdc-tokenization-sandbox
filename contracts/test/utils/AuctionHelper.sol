// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {BidIntentHelper} from "./BidIntentHelper.sol";
import {BondAuction} from "@norges-bank/BondAuction.sol";
import {BondManager} from "@norges-bank/BondManager.sol";
import {IBondAuction} from "@norges-bank/interfaces/IBondAuction.sol";
import {Wnok} from "@norges-bank/Wnok.sol";

/// @notice Shared test utilities for submitting bids, funding bidders, and building bid intent proofs.
contract AuctionHelper is BidIntentHelper {
    BondAuction internal auction;
    BondManager internal manager;
    Wnok internal wnok;
    address internal bondAdmin;

    bytes32 internal defaultPlaintextHash;
    bytes internal defaultCiphertext;
    uint256 internal unitNominal;
    uint256 internal percentagePrecision;

    mapping(address => uint256) internal bidderPrivateKeys;

    function initContracts(BondAuction _auction, BondManager _manager, Wnok _wnok) internal {
        auction = _auction;
        manager = _manager;
        wnok = _wnok;
    }

    function initActors(address _bondAdmin) internal {
        bondAdmin = _bondAdmin;
    }

    function initGlobals(
        bytes32 plaintextHash,
        bytes memory ciphertext,
        uint256 _unitNominal,
        uint256 _percentagePrecision
    ) internal {
        defaultPlaintextHash = plaintextHash;
        defaultCiphertext = ciphertext;
        unitNominal = _unitNominal;
        percentagePrecision = _percentagePrecision;
    }

    function registerBidder(address bidder, uint256 privateKey) internal {
        bidderPrivateKeys[bidder] = privateKey;
    }

    function _submitBids(bytes32 auctionId, address[] memory bidders) internal {
        for (uint256 i = 0; i < bidders.length; i++) {
            _submitBid(auctionId, bidders[i]);
        }
    }

    function _submitBid(bytes32 auctionId, address bidder) internal {
        vm.prank(bidder);
        auction.submitBid(auctionId, defaultCiphertext, defaultPlaintextHash);
    }

    function _prefundAndApprove(address bidder, uint256 amount) internal {
        vm.prank(bondAdmin);
        wnok.mint(bidder, amount);
        vm.prank(bidder);
        wnok.approve(address(manager.BOND_DVP()), amount);
    }

    function _proofs(bytes32 auctionId, address[] memory bidders, uint256[] memory nonces)
        internal
        view
        returns (IBondAuction.BidVerification[] memory)
    {
        IBondAuction.BidVerification[] memory proofs = new IBondAuction.BidVerification[](bidders.length);
        for (uint256 i = 0; i < bidders.length; i++) {
            proofs[i] = _proof(auctionId, i, bidders[i], nonces[i]);
        }
        return proofs;
    }

    function _proof(bytes32 auctionId, uint256 bidIndex, address bidder, uint256 bidderNonce)
        internal
        view
        returns (IBondAuction.BidVerification memory)
    {
        uint256 pk = bidderPrivateKeys[bidder];
        require(pk != 0, "bidder pk not registered");
        bytes memory sig =
            signBidIntent(pk, bidder, auctionId, defaultPlaintextHash, bidderNonce, address(auction), block.chainid);
        return IBondAuction.BidVerification({bidIndex: bidIndex, bidderNonce: bidderNonce, bidderSig: sig});
    }

    function _paymentDue(uint256 rateBps, uint256 units) internal view returns (uint256) {
        return (rateBps * (units * unitNominal)) / percentagePrecision;
    }
}
