// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.29;

import {DvP} from "@csd/DvP.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {StockToken} from "@csd/StockToken.sol";
import {OrderBook} from "@csd/OrderBook.sol";
import {Tbd} from "@private-bank/Tbd.sol";
import {Test} from "forge-std/Test.sol";
import {Wnok} from "@norges-bank/Wnok.sol";
import {StockTokenFactory} from "@csd/StockTokenFactory.sol";
import {Roles} from "@common/Roles.sol";
import {SettlementInfo} from "@common/SettlementInfo.sol";
import {Broker} from "@broker/Broker.sol";
import {IOrderBook} from "@interfaces/IOrderBook.sol";

/**
 * Tests trade of a stock with 8 contracts:
 *   - Broker (Oslo)
 *   - Broker (Stavanger)
 *   - Wnok (Norges Bank),
 *   - Tbd (OSLOTBD),
 *   - Tbd (STAVANGERTBD)
 *   - DvP (CSD)
 *   - StockToken (CSD)
 *   - OrderBook (CSD)
 * and 2 investors:
 *   - investor1 (customer of OSLO)
 *   - investor2 (customer of STAVANGER)
 * as well as their respective banks and brokers.
 */
contract OrderBookIntegrationTest is Test {
    struct StockParams {
        string name;
        string symbol;
        string isin;
        string issuerName;
        string description;
        address issuerAddr;
        uint256 initialSupply;
    }

    /// @notice Structure to hold investor data
    struct Investor {
        address tbd;
        address sec;
        address broker;
        address tbdContr;
    }

    string tbd1Name = "OSLOTBD";
    string tbd1Symbol = "OSLOTBD";
    string tbd2Name = "STAVANGERTBD";
    string tbd2Symbol = "STAVANGERTBD";
    string wnokName = "Wholesale NOK";
    string wnokSymbol = "wNOK";

    address tbd1admin = address(0x1);
    address tbd2admin = address(0x2);
    address wnokadmin = address(0x3);
    address csdadmin = address(0x4);

    address bank1 = address(0x5);
    address bank2 = address(0x6);

    address broker1Admin = address(0x7);
    address broker2Admin = address(0x8);

    address investorATbd = address(0xa);
    address investorBTbd = address(0xb);
    address investorCTbd = address(0xc);
    address investorDTbd = address(0xd0);

    address investorASec = address(0xd);
    address investorBSec = address(0xe);
    address investorCSec = address(0xf);
    address investorDSec = address(0xd1);

    address investorAIdentity = address(0xa0);
    address investorBIdentity = address(0xb0);
    address investorCIdentity = address(0xc0);
    address investorDIdentity = address(0xd2);

    uint256 initAmountBank1Wnok = 1_000;
    uint256 initAmountBank2Wnok = 5_000;

    // investors A and C are at bank 1, B is at bank 2
    uint256 initBalanceInvestorATbd = 200;
    uint256 initBalanceInvestorBTbd = 0;
    uint256 initBalanceInvestorCTbd = 0;
    uint256 initBalanceInvestorDTbd = 0;

    uint256 initBalanceInvestorASec = 0;
    uint256 initBalanceInvestorBSec = 10;
    uint256 initBalanceInvestorCSec = 10;
    uint256 initBalanceInvestorDSec = 10;

    StockParams stockParams = StockParams({
        name: "EquiNor",
        symbol: "EqNr",
        isin: "NO00001234",
        issuerName: "EquiNor ASA",
        description: "EuroNext description",
        issuerAddr: csdadmin,
        initialSupply: 1_000_000
    });

    Broker public broker1;
    Broker public broker2;
    Tbd public tbd1;
    Tbd public tbd2;
    Wnok public wnok;
    DvP public dvp;
    StockToken public sec;
    OrderBook public orderBook;

    uint256 cctAmount = 100;

    uint256 secAmount = 1;
    uint256 askPrice = 100;
    uint256 bidPrice = 120;
    // Settlement price is the maker's price:
    // - When buy order is in book first, maker is buy order, so settlementPrice = bidPrice
    // - When sell order is in book first, maker is sell order, so settlementPrice = askPrice
    uint256 settlementPriceBuyFirst = bidPrice; // When buy order is maker
    uint256 settlementPriceSellFirst = askPrice; // When sell order is maker

    Investor investorA;
    Investor investorB;
    Investor investorC;
    Investor investorD;

    function setUp() public {
        // Create wNOK, DvP, TBDs
        wnok = new Wnok(wnokadmin, wnokName, wnokSymbol);
        dvp = new DvP(csdadmin);
        tbd1 = new Tbd(tbd1admin, bank1, address(wnok), address(dvp), tbd1Name, tbd1Symbol, address(0));
        tbd2 = new Tbd(tbd2admin, bank2, address(wnok), address(dvp), tbd2Name, tbd2Symbol, address(0));

        vm.startPrank(tbd1admin);
        tbd1.add(investorATbd);
        tbd1.grantRole(Roles.CCT_FROM_CALLER_ROLE, investorATbd);
        tbd1.mint(investorATbd, initBalanceInvestorATbd);

        tbd1.add(investorCTbd);
        tbd1.grantRole(Roles.CCT_FROM_CALLER_ROLE, investorCTbd);
        tbd1.mint(investorCTbd, initBalanceInvestorCTbd);

        tbd1.add(investorDTbd);
        tbd1.grantRole(Roles.CCT_FROM_CALLER_ROLE, investorDTbd);
        tbd1.mint(investorDTbd, initBalanceInvestorDTbd);
        vm.stopPrank();

        vm.startPrank(tbd2admin);
        tbd2.add(investorBTbd);
        tbd2.grantRole(Roles.CCT_FROM_CALLER_ROLE, investorBTbd);
        tbd2.mint(investorBTbd, initBalanceInvestorBTbd);
        vm.stopPrank();

        vm.startPrank(wnokadmin);
        wnok.add(bank1);
        wnok.add(bank2);
        wnok.add(address(tbd1));
        wnok.add(address(tbd2));
        wnok.mint(bank1, initAmountBank1Wnok);
        wnok.mint(bank2, initAmountBank2Wnok);
        wnok.grantRole(Roles.TRANSFER_FROM_ROLE, address(tbd1));
        wnok.grantRole(Roles.TRANSFER_FROM_ROLE, address(tbd2));
        vm.stopPrank();

        // Give TBD contracts infinite allowance over their banks' wNOK
        vm.prank(bank1);
        wnok.approve(address(tbd1), type(uint256).max);
        vm.prank(bank2);
        wnok.approve(address(tbd2), type(uint256).max);

        // Create Security and OrderBook (both owned by csdadmin)
        StockTokenFactory factory = new StockTokenFactory(address(new StockToken()), csdadmin);
        vm.startPrank(stockParams.issuerAddr);
        sec = StockToken(
            factory.createStockToken(
                stockParams.name,
                stockParams.symbol,
                stockParams.isin,
                stockParams.initialSupply,
                stockParams.issuerName,
                stockParams.description
            )
        );
        vm.stopPrank();

        // Create OrderBook for the security we just created
        orderBook = new OrderBook(csdadmin, address(wnok), address(dvp), address(sec));

        vm.startPrank(csdadmin);
        sec.add(investorASec);
        sec.add(investorBSec);
        sec.add(investorCSec);
        sec.add(investorDSec);
        assertTrue(sec.transfer(investorASec, initBalanceInvestorASec));
        assertTrue(sec.transfer(investorBSec, initBalanceInvestorBSec));
        assertTrue(sec.transfer(investorCSec, initBalanceInvestorCSec));
        assertTrue(sec.transfer(investorDSec, initBalanceInvestorDSec));
        sec.grantRole(Roles.CUSTODIAL_TRANSFER_ROLE, address(dvp));
        vm.stopPrank();

        vm.startPrank(broker1Admin);
        broker1 = new Broker(broker1Admin, address(orderBook));
        broker1.addClient(investorAIdentity, investorATbd, investorASec, address(tbd1));
        broker1.addClient(investorCIdentity, investorCTbd, investorCSec, address(tbd1));
        vm.stopPrank();

        vm.startPrank(broker2Admin);
        broker2 = new Broker(broker2Admin, address(orderBook));
        broker2.addClient(investorBIdentity, investorBTbd, investorBSec, address(tbd2));
        broker2.addClient(investorDIdentity, investorDTbd, investorDSec, address(tbd1));
        vm.stopPrank();

        vm.startPrank(csdadmin);
        dvp.grantRole(Roles.SETTLE_ROLE, csdadmin);
        dvp.grantRole(Roles.SETTLE_ROLE, address(orderBook));
        orderBook.grantRole(Roles.SUBMIT_ORDER_ROLE, address(broker1));
        orderBook.grantRole(Roles.SUBMIT_ORDER_ROLE, address(broker2));
        vm.stopPrank();

        vm.startPrank(tbd1admin);
        tbd1.grantRole(Roles.CCT_FROM_CALLER_ROLE, address(dvp));
        vm.stopPrank();

        vm.startPrank(tbd2admin);
        tbd2.grantRole(Roles.CCT_FROM_CALLER_ROLE, address(dvp));
        vm.stopPrank();

        // investors:
        // A at bank 1 / broker 1
        // B at bank 2 / broker 2
        // C at bank 1 / broker 1
        // D at bank 1 / broker 2
        investorA = Investor({tbd: investorATbd, sec: investorASec, broker: address(broker1), tbdContr: address(tbd1)});
        investorB = Investor({tbd: investorBTbd, sec: investorBSec, broker: address(broker2), tbdContr: address(tbd2)});
        investorC = Investor({tbd: investorCTbd, sec: investorCSec, broker: address(broker1), tbdContr: address(tbd1)});
        investorD = Investor({tbd: investorDTbd, sec: investorDSec, broker: address(broker2), tbdContr: address(tbd1)});
    }

    /**
     * checks no tokens stranded anywhere they should not
     */
    function _assertEmpty() internal view {
        // the contract addresses do not own wnok, tbd1, tbd2
        _assertBalanceEmpty(wnok, address(tbd1));
        _assertBalanceEmpty(wnok, address(tbd2));
        _assertBalanceEmpty(wnok, address(wnok));
        _assertBalanceEmpty(wnok, address(sec));
        _assertBalanceEmpty(tbd1, address(tbd1));
        _assertBalanceEmpty(tbd1, address(tbd2));
        _assertBalanceEmpty(tbd1, address(wnok));
        _assertBalanceEmpty(tbd1, address(sec));
        _assertBalanceEmpty(tbd2, address(tbd1));
        _assertBalanceEmpty(tbd2, address(tbd2));
        _assertBalanceEmpty(tbd2, address(wnok));
        _assertBalanceEmpty(tbd2, address(sec));

        // the brokers and investors do not own wnok
        _assertBalanceEmpty(wnok, address(broker1));
        _assertBalanceEmpty(wnok, address(broker2));
        _assertBalanceEmpty(wnok, investorA.tbd);
        _assertBalanceEmpty(wnok, investorB.tbd);
        _assertBalanceEmpty(wnok, investorC.tbd);
        _assertBalanceEmpty(wnok, investorD.tbd);
        _assertBalanceEmpty(wnok, investorA.sec);
        _assertBalanceEmpty(wnok, investorB.sec);
        _assertBalanceEmpty(wnok, investorC.sec);
        _assertBalanceEmpty(wnok, investorD.sec);

        // the banks, brokers, investorB, investor sec addreses do not own tbd1
        _assertBalanceEmpty(tbd1, bank1);
        _assertBalanceEmpty(tbd1, bank2);
        _assertBalanceEmpty(tbd1, address(broker1));
        _assertBalanceEmpty(tbd1, address(broker2));
        _assertBalanceEmpty(tbd1, investorB.tbd);
        _assertBalanceEmpty(tbd1, investorA.sec);
        _assertBalanceEmpty(tbd1, investorB.sec);
        _assertBalanceEmpty(tbd1, investorC.sec);
        _assertBalanceEmpty(tbd1, investorD.sec);

        // the banks, brokers, investorA, investor C, investor sec addreses do not own tbd2
        _assertBalanceEmpty(tbd2, bank1);
        _assertBalanceEmpty(tbd2, bank2);
        _assertBalanceEmpty(tbd2, address(broker1));
        _assertBalanceEmpty(tbd2, address(broker2));
        _assertBalanceEmpty(tbd2, investorA.tbd);
        _assertBalanceEmpty(tbd2, investorC.tbd);
        _assertBalanceEmpty(tbd2, investorD.tbd);
        _assertBalanceEmpty(tbd2, investorA.sec);
        _assertBalanceEmpty(tbd2, investorC.sec);
        _assertBalanceEmpty(tbd2, investorD.sec);

        // the banks and brokers do not own securities
        assertEq(sec.balanceOf(bank1), 0);
        assertEq(sec.balanceOf(bank2), 0);
        assertEq(sec.balanceOf(address(broker1)), 0);
        assertEq(sec.balanceOf(address(broker2)), 0);
    }

    /**
     * checks if funds are like initialized (upon reverts)
     */
    function _assertInitFunds() internal view {
        assertEq(wnok.balanceOf(bank1), initAmountBank1Wnok);
        assertEq(wnok.balanceOf(bank2), initAmountBank2Wnok);
        assertEq(tbd1.balanceOf(investorA.tbd), initBalanceInvestorATbd);
        assertEq(tbd2.balanceOf(investorB.tbd), initBalanceInvestorBTbd);
        assertEq(tbd1.balanceOf(investorC.tbd), initBalanceInvestorCTbd);
        assertEq(tbd1.balanceOf(investorD.tbd), initBalanceInvestorDTbd);
        assertEq(sec.balanceOf(investorA.sec), initBalanceInvestorASec);
        assertEq(sec.balanceOf(investorB.sec), initBalanceInvestorBSec);
        assertEq(sec.balanceOf(investorC.sec), initBalanceInvestorCSec);
        assertEq(sec.balanceOf(investorD.sec), initBalanceInvestorDSec);
        assertEq(wnok.allowance(bank1, address(tbd1)), type(uint256).max);
        assertEq(wnok.allowance(bank2, address(tbd2)), type(uint256).max);
    }

    function _assertBalanceEmpty(ERC20 contr, address account) internal view {
        assertEq(contr.balanceOf(account), 0);
    }

    function _assertOrderBookEmpty() internal {
        vm.startPrank(investorA.broker);
        IOrderBook.Order[] memory buyOrders = orderBook.getBuyOrders();
        IOrderBook.Order[] memory sellOrders = orderBook.getSellOrders();
        vm.stopPrank();
        assertEq(buyOrders.length, 0);
        assertEq(sellOrders.length, 0);

        vm.startPrank(investorB.broker);
        buyOrders = orderBook.getBuyOrders();
        sellOrders = orderBook.getSellOrders();
        vm.stopPrank();
        assertEq(buyOrders.length, 0);
        assertEq(sellOrders.length, 0);

        vm.startPrank(investorC.broker);
        buyOrders = orderBook.getBuyOrders();
        sellOrders = orderBook.getSellOrders();
        vm.stopPrank();
        assertEq(buyOrders.length, 0);
        assertEq(sellOrders.length, 0);
    }

    function _assertBalancesAfterInterBankTrade() internal view {
        // When buy order is in book first, maker is buy order, so settlement price is bidPrice
        assertEq(tbd1.balanceOf(investorA.tbd), initBalanceInvestorATbd - settlementPriceBuyFirst);
        assertEq(tbd2.balanceOf(investorB.tbd), initBalanceInvestorBTbd + settlementPriceBuyFirst);
        assertEq(sec.balanceOf(investorA.sec), initBalanceInvestorASec + secAmount);
        assertEq(sec.balanceOf(investorB.sec), initBalanceInvestorBSec - secAmount);
        assertEq(wnok.balanceOf(bank1), initAmountBank1Wnok - settlementPriceBuyFirst);
        assertEq(wnok.balanceOf(bank2), initAmountBank2Wnok + settlementPriceBuyFirst);
    }

    function _assertBalancesAfterIntraBankTrade() internal view {
        // When buy order is in book first, maker is buy order, so settlement price is bidPrice
        assertEq(tbd1.balanceOf(investorA.tbd), initBalanceInvestorATbd - settlementPriceBuyFirst);
        assertEq(tbd1.balanceOf(investorC.tbd), initBalanceInvestorCTbd + settlementPriceBuyFirst);
        assertEq(sec.balanceOf(investorA.sec), initBalanceInvestorASec + secAmount);
        assertEq(sec.balanceOf(investorC.sec), initBalanceInvestorCSec - secAmount);

        // A and C are in the same bank 1, so no changes in the wholesale balances
        assertEq(wnok.balanceOf(bank1), initAmountBank1Wnok);
        assertEq(wnok.balanceOf(bank2), initAmountBank2Wnok);
    }

    function _assertBalancesAfterIntraBankButInterBrokerTrade() internal view {
        // When buy order is in book first, maker is buy order, so settlement price is bidPrice
        assertEq(tbd1.balanceOf(investorA.tbd), initBalanceInvestorATbd - settlementPriceBuyFirst);
        assertEq(tbd1.balanceOf(investorD.tbd), initBalanceInvestorDTbd + settlementPriceBuyFirst);
        assertEq(sec.balanceOf(investorA.sec), initBalanceInvestorASec + secAmount);
        assertEq(sec.balanceOf(investorD.sec), initBalanceInvestorDSec - secAmount);

        // A and C are in the same bank 1, so no changes in the wholesale balances
        assertEq(wnok.balanceOf(bank1), initAmountBank1Wnok);
        assertEq(wnok.balanceOf(bank2), initAmountBank2Wnok);
    }

    function _assertBalancesAfterInterBankTradeSellFirst() internal view {
        // When sell order is in book first, maker is sell order, so settlement price is askPrice
        assertEq(tbd1.balanceOf(investorA.tbd), initBalanceInvestorATbd - settlementPriceSellFirst);
        assertEq(tbd2.balanceOf(investorB.tbd), initBalanceInvestorBTbd + settlementPriceSellFirst);
        assertEq(sec.balanceOf(investorA.sec), initBalanceInvestorASec + secAmount);
        assertEq(sec.balanceOf(investorB.sec), initBalanceInvestorBSec - secAmount);
        assertEq(wnok.balanceOf(bank1), initAmountBank1Wnok - settlementPriceSellFirst);
        assertEq(wnok.balanceOf(bank2), initAmountBank2Wnok + settlementPriceSellFirst);
    }

    function _assertBalancesAfterIntraBankTradeSellFirst() internal view {
        // When sell order is in book first, maker is sell order, so settlement price is askPrice
        assertEq(tbd1.balanceOf(investorA.tbd), initBalanceInvestorATbd - settlementPriceSellFirst);
        assertEq(tbd1.balanceOf(investorC.tbd), initBalanceInvestorCTbd + settlementPriceSellFirst);
        assertEq(sec.balanceOf(investorA.sec), initBalanceInvestorASec + secAmount);
        assertEq(sec.balanceOf(investorC.sec), initBalanceInvestorCSec - secAmount);

        // A and C are in the same bank 1, so no changes in the wholesale balances
        assertEq(wnok.balanceOf(bank1), initAmountBank1Wnok);
        assertEq(wnok.balanceOf(bank2), initAmountBank2Wnok);
    }

    function _assertBalancesAfterIntraBankButInterBrokerTradeSellFirst() internal view {
        // When sell order is in book first, maker is sell order, so settlement price is askPrice
        assertEq(tbd1.balanceOf(investorA.tbd), initBalanceInvestorATbd - settlementPriceSellFirst);
        assertEq(tbd1.balanceOf(investorD.tbd), initBalanceInvestorDTbd + settlementPriceSellFirst);
        assertEq(sec.balanceOf(investorA.sec), initBalanceInvestorASec + secAmount);
        assertEq(sec.balanceOf(investorD.sec), initBalanceInvestorDSec - secAmount);

        // A and D are in the same bank 1, so no changes in the wholesale balances
        assertEq(wnok.balanceOf(bank1), initAmountBank1Wnok);
        assertEq(wnok.balanceOf(bank2), initAmountBank2Wnok);
    }

    function test_buyWithNoMatchingOrder() public {
        vm.startPrank(investorAIdentity);
        broker1.buy(address(sec), secAmount, bidPrice);
        IOrderBook.Order[] memory buyOrders = broker1.getBuyOrders();
        vm.stopPrank();

        assertEq(buyOrders.length, 1);
        assertEq(buyOrders[0].investorSecAddr, investorA.sec);
        assertEq(buyOrders[0].amount, secAmount);
        assertEq(buyOrders[0].price, bidPrice);

        _assertInitFunds();
        _assertEmpty();
    }

    function test_sellWithNoMatchingOrder() public {
        vm.startPrank(investorBIdentity);
        broker2.sell(address(sec), secAmount, askPrice);
        IOrderBook.Order[] memory sellOrders = broker2.getSellOrders();
        vm.stopPrank();

        assertEq(sellOrders.length, 1);
        assertEq(sellOrders[0].investorSecAddr, investorB.sec);
        assertEq(sellOrders[0].amount, secAmount);
        assertEq(sellOrders[0].price, askPrice);

        _assertInitFunds();
        _assertEmpty();
    }

    function test_buyThenRevoke() public {
        vm.startPrank(investorAIdentity);
        SettlementInfo memory settlementInfo = broker1.buy(address(sec), secAmount, bidPrice);
        broker1.revokeBuyOrder(settlementInfo.orderId);
        vm.stopPrank();

        _assertInitFunds();
        _assertEmpty();
        _assertOrderBookEmpty();
    }

    function test_sellThenRevoke() public {
        vm.startPrank(investorBIdentity);
        SettlementInfo memory settlementInfo = broker2.sell(address(sec), secAmount, askPrice);
        broker2.revokeSellOrder(settlementInfo.orderId);
        vm.stopPrank();

        _assertInitFunds();
        _assertEmpty();
        _assertOrderBookEmpty();
    }

    function test_buyThenSellInterBank() public {
        vm.prank(investorAIdentity);
        broker1.buy(address(sec), secAmount, bidPrice);

        vm.prank(investorBIdentity);
        broker2.sell(address(sec), secAmount, askPrice);

        _assertBalancesAfterInterBankTrade();
        _assertEmpty();
        _assertOrderBookEmpty();
    }

    function test_sellThenBuyInterBank() public {
        vm.prank(investorBIdentity);
        broker2.sell(address(sec), secAmount, askPrice);

        vm.prank(investorAIdentity);
        broker1.buy(address(sec), secAmount, bidPrice);

        // When sell order is in book first, maker is sell order, so settlement price is askPrice
        _assertBalancesAfterInterBankTradeSellFirst();
        _assertEmpty();
        _assertOrderBookEmpty();
    }

    function test_buyThenSellIntraBank() public {
        vm.prank(investorAIdentity);
        broker1.buy(address(sec), secAmount, bidPrice);

        vm.prank(investorCIdentity);
        broker1.sell(address(sec), secAmount, askPrice);

        _assertBalancesAfterIntraBankTrade();
        _assertEmpty();
        _assertOrderBookEmpty();
    }

    function test_sellThenBuyIntraBank() public {
        vm.prank(investorCIdentity);
        broker1.sell(address(sec), secAmount, askPrice);

        vm.prank(investorAIdentity);
        broker1.buy(address(sec), secAmount, bidPrice);

        // When sell order is in book first, maker is sell order, so settlement price is askPrice
        _assertBalancesAfterIntraBankTradeSellFirst();
        _assertEmpty();
        _assertOrderBookEmpty();
    }

    function test_buyThenSellIntraBankButInterBroker() public {
        vm.prank(investorAIdentity);
        broker1.buy(address(sec), secAmount, bidPrice);

        vm.prank(investorDIdentity);
        broker2.sell(address(sec), secAmount, askPrice);

        _assertBalancesAfterIntraBankButInterBrokerTrade();
        _assertEmpty();
        _assertOrderBookEmpty();
    }

    function test_sellThenBuyIntraBankButInterBroker() public {
        vm.prank(investorDIdentity);
        broker2.sell(address(sec), secAmount, askPrice);

        vm.prank(investorAIdentity);
        broker1.buy(address(sec), secAmount, bidPrice);

        // When sell order is in book first, maker is sell order, so settlement price is askPrice
        _assertBalancesAfterIntraBankButInterBrokerTradeSellFirst();
        _assertEmpty();
        _assertOrderBookEmpty();
    }
}
