// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.29;

import {RegistryScript} from "../common/RegistryScript.sol";

import {GlobalRegistry} from "@common/GlobalRegistry.sol";
import {BondAuction} from "@norges-bank/BondAuction.sol";
import {BondToken} from "@norges-bank/BondToken.sol";
import {BondDvP} from "@norges-bank/BondDvP.sol";
import {Wnok} from "@norges-bank/Wnok.sol";

import {Roles} from "@common/Roles.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract BondSetupScript is RegistryScript {
    function setUp() public {}

    function run() public {
        uint256 deployerKey = vm.envUint("PK_DEPLOYER");
        uint256 govReserveKey = vm.envUint("PK_GOV_RESERVE");
        uint256 ownerKey = vm.envUint("PK_NORGES_BANK");
        address owner = vm.addr(ownerKey);

        // 2 verified bidders (PDs)
        uint256 dnbKey = vm.envUint("PK_DNB");
        uint256 nordeaKey = vm.envUint("PK_NORDEA");

        address registryAddr = vm.envAddress("REGISTRY_ADDR");
        _ensureRegistry(registryAddr, owner);
        GlobalRegistry registry = GlobalRegistry(registryAddr);

        string memory bondAuctionName = vm.envString("BOND_AUCTION_CONTRACT_NAME");
        string memory bondManagerName = vm.envString("BOND_MANAGER_CONTRACT_NAME");
        string memory bondTokenName = vm.envString("BOND_TOKEN_CONTRACT_NAME");
        string memory wnokName = vm.envString("WNOK_CONTRACT_NAME");
        string memory bondDvpName = vm.envString("BOND_DVP_CONTRACT_NAME");

        address bondManagerAddr = registry.getContract(bondManagerName);

        BondAuction bondAuction = BondAuction(registry.getContract(bondAuctionName));
        BondToken bondToken = BondToken(registry.getContract(bondTokenName));
        BondDvP bondDvp = BondDvP(registry.getContract(bondDvpName));

        Wnok wnok = Wnok(registry.getContract(wnokName));

        vm.startBroadcast(deployerKey);

        bondAuction.grantRole(Roles.BOND_AUCTION_ADMIN_ROLE, bondManagerAddr);

        // BondManager runs the bond lifecycle but never moves holder units itself, so it gets
        // BOND_CONTROLLER_ROLE only. BondDvP moves units in settlement (ERC-1410 controller)
        // and burns them on redemption and buyback (BOND_CONTROLLER_ROLE).
        bondToken.grantRole(Roles.BOND_CONTROLLER_ROLE, bondManagerAddr);
        bondToken.addController(address(bondDvp));
        bondToken.grantRole(Roles.BOND_CONTROLLER_ROLE, address(bondDvp));

        bondDvp.grantRole(Roles.SETTLE_ROLE, bondManagerAddr);

        vm.stopBroadcast();

        // Bidder addresses
        address dnbAddr = vm.addr(dnbKey);
        address nordeaAddr = vm.addr(nordeaKey);

        // Add WNOK balances to bidders
        vm.startBroadcast(ownerKey);
        wnok.grantRole(Roles.TRANSFER_FROM_ROLE, address(bondDvp));

        wnok.add(dnbAddr);
        wnok.mint(dnbAddr, 1_000_000);
        wnok.add(nordeaAddr);
        wnok.mint(nordeaAddr, 1_000_000);
        vm.stopBroadcast();

        // Government reserve lets BondDvP debit its WNOK for buyback, coupon, and redemption
        vm.startBroadcast(govReserveKey);
        wnok.approve(address(bondDvp), type(uint256).max);
        vm.stopBroadcast();

        // Wnok approvals for bidders
        vm.startBroadcast(nordeaKey); // Nordea
        wnok.approve(address(bondDvp), type(uint256).max);
        vm.stopBroadcast();

        vm.startBroadcast(dnbKey); // DNB
        wnok.approve(address(bondDvp), type(uint256).max);
        vm.stopBroadcast();

        _handAdminToOwner(deployerKey, owner, bondManagerAddr, bondAuction, bondToken, bondDvp);
    }

    /**
     * @dev The deployer key is only needed to deploy and wire the bond contracts. Once wiring is
     *      done, the Norges Bank owner key takes over DEFAULT_ADMIN_ROLE (and BOND_ADMIN_ROLE on
     *      BondToken) so roles can still be rotated, and the deployer renounces its own.
     */
    function _handAdminToOwner(
        uint256 deployerKey,
        address owner,
        address bondManagerAddr,
        BondAuction bondAuction,
        BondToken bondToken,
        BondDvP bondDvp
    ) internal {
        address deployer = vm.addr(deployerKey);
        if (deployer == owner) return;

        IAccessControl[4] memory bondContracts = [
            IAccessControl(bondManagerAddr),
            IAccessControl(address(bondAuction)),
            IAccessControl(address(bondToken)),
            IAccessControl(address(bondDvp))
        ];

        vm.startBroadcast(deployerKey);
        bondToken.grantRole(Roles.BOND_ADMIN_ROLE, owner);
        bondToken.renounceRole(Roles.BOND_ADMIN_ROLE, deployer);
        for (uint256 i = 0; i < bondContracts.length; i++) {
            bondContracts[i].grantRole(Roles.DEFAULT_ADMIN_ROLE, owner);
            bondContracts[i].renounceRole(Roles.DEFAULT_ADMIN_ROLE, deployer);
        }
        vm.stopBroadcast();
    }
}
