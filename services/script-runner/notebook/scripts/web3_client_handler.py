from datetime import datetime
import requests
from eth_account import Account
from web3.middleware import ExtraDataToPOAMiddleware
from web3 import Web3
import pytz
from scripts import config as c
from scripts.ui.utils.database_utils import get_domain_for_address


def get_w3_client():
    """Returns a web3 client with which to connect to our besu network."""
    w3 = Web3(Web3.HTTPProvider(c.network["http_rpc_url"]))
    w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
    return w3


class Web3ClientHandler:
    """Handles blockchain contract interactions for UI views"""

    def __init__(self, w3, global_registry, contract_name, contract_file_name):
        self.w3 = w3
        self.global_registry = global_registry
        self.contract_name = contract_name
        self.contract_file_name = contract_file_name
        self.contract = self.init_contract(contract_name, contract_file_name)

    def init_contract(self, name: str, file_name: str):
        """Initialize a contract given name and file_name"""
        address = self.get_contract_address(name)
        self.contract_address = address
        abi = self._load_abi_file(file_name)
        return self.w3.eth.contract(address=address, abi=abi)

    def get_contract_name(self, address: str, file_name):
        """Initialize a contract given address and file_name"""
        abi = self._load_abi_file(file_name)
        contract = self.w3.eth.contract(address=address, abi=abi)
        return contract.functions.name().call()

    def get_contract_address(self, name: str) -> str:
        """Returns the contract address for the provided name in the registry."""
        return self.global_registry.functions.getContract(name).call()

    def get_tbd_contract_address(self, broker_contract, client_wallet: str) -> str:
        """Returns the TBD contract address given a broker contract and client address"""
        return broker_contract.functions.getTbdContrAddr(client_wallet).call()

    def get_contract(self, name: str, file_name: str) -> tuple:
        """Returns a (contract, address) tuple for the provided name in the registry."""
        address = self.get_contract_address(name)
        abi = self._load_abi_file(file_name)
        return self.w3.eth.contract(address=address, abi=abi), address

    def _load_abi_file(self, file_name: str) -> str:
        try:
            filepath = f"contracts/{file_name}.sol/{file_name}.abi"
            with open(filepath, "r", encoding="utf-8") as file:
                return "".join(file.read().splitlines())
        except FileNotFoundError as e:
            raise Exception(f"ABI file not found at path: {filepath}") from e

    def _get_stocktokenfactory_contract(self) -> object:
        return self.init_contract("StockToken Factory", "StockTokenFactory")

    def get_all_isins(self) -> list:
        """Retrieve and return all deployed stock token ISINs."""
        stocktokenfactory = self._get_stocktokenfactory_contract()
        return stocktokenfactory.functions.getAllDeployedStockTokenIsins().call()

    def get_listings(self, isins: list, logger) -> list:
        """Retrieve listing information for given ISINs."""
        listings = []
        for isin in isins:
            try:
                listing_info = self.get_listing_info(isin)
                listings.append(listing_info)
            except Exception as e:
                logger.error("Error retrieving listing for ISIN %s: %s", isin, e)
        return listings

    def get_listing_info(self, isin: str) -> dict:
        """Returns listing info for a given ISIN."""
        contract, address = self.get_stock_token_contract(isin)
        return {
            "name": contract.functions.name().call(),
            "symbol": contract.functions.symbol().call(),
            "total_supply": contract.functions.totalSupply().call(),
            "isin": isin,
            "issuer_name": contract.functions.securityIssuerName().call(),
            "description": contract.functions.securityDescription().call(),
            "address": address,
        }

    def load_listings(self, logger) -> list:
        """Retrieve and return all stock token listings"""
        try:
            isins = self.get_all_isins()
            listings = self.get_listings(isins, logger)
            return listings
        except Exception as e:
            logger.error("Error during _load_listings: %s", e)
            return None

    def do_contract_tx(
        self, function_name: str, tx_args: list, caller_key, logger, contract=None
    ) -> dict:
        """Execute a contract transaction and return the transaction receipt"""
        try:
            caller = Account().from_key(caller_key)
            current_contract = contract if contract is not None else self.contract
            transaction_data = current_contract.functions[function_name](
                *tx_args
            ).build_transaction(
                {
                    "chainId": self.w3.eth.chain_id,
                    "gas": 2000000000,
                    "gasPrice": self.w3.eth.gas_price,
                    "nonce": self.w3.eth.get_transaction_count(caller.address),
                }
            )
            signed_txn = self.w3.eth.account.sign_transaction(
                transaction_data, private_key=caller_key
            )
            tx_hash = self.w3.eth.send_raw_transaction(signed_txn.raw_transaction)
            tx_receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
            return tx_receipt
        except Exception as e:
            logger.error(
                'Error during do_contract_tx function_name="%s": %s', function_name, e
            )
            return None

    def load_balances(self) -> list:
        """Load and return balances for specified entities."""
        addresses = self.contract.functions.allowlistQueryAll().call()
        return [
            [
                get_domain_for_address(addr),
                addr,
                str(self.contract.functions.balanceOf(addr).call()),
            ]
            for addr in addresses
            if get_domain_for_address(addr)
            is not None  # ignore TBD-contracts on allowlist
        ]

    def load_allowlist(self) -> list:
        """Load and return allowlist status for specified entities."""
        addresses = self.contract.functions.allowlistQueryAll().call()
        return [
            [get_domain_for_address(addr), addr]
            for addr in addresses
            if get_domain_for_address(addr)
            is not None  # ignore TBD-contracts on allowlist
        ]

    def load_allowlist_with_names(self, isin: str) -> list:
        """Returns all allowed addresses given a stock ISIN"""
        contract, _ = self.get_stock_token_contract(isin)
        addresses = contract.functions.allowlistQueryAll().call()
        return [
            {"name": get_domain_for_address(addr), "address": addr}
            for addr in addresses
        ]

    def get_stock_token_contract(self, isin: str) -> tuple:
        """Return StockToken contract given an ISIN."""
        stocktokenfactory = self._get_stocktokenfactory_contract()
        found, address = stocktokenfactory.functions.getDeployedStockToken(isin).call()
        if not found:
            raise Exception(f"StockToken for ISIN {isin} not found.")
        abi = self._load_abi_file("StockToken")
        return self.w3.eth.contract(address=address, abi=abi), address

    def get_account_info(
        self,
        broker_contract_name: str,
        tbd_contract_name: str,
        address: str,
        isin: str,
        logger,
    ) -> dict:
        """Returns account info for a given account address (Broker View)"""
        all_clients_addresses = self.get_all_clients(
            broker_contract_name,
            "Broker",
            logger,
        )
        tbd_contract = self.init_contract(tbd_contract_name, "Tbd")
        stock_token_contract, _ = self.get_stock_token_contract(isin)
        money_wallet = self.get_money_wallet(all_clients_addresses, address, logger)
        securities_wallet = self.get_securities_wallet(
            all_clients_addresses, address, logger
        )
        return {
            "balance": tbd_contract.functions.balanceOf(money_wallet).call(),
            "holdings": stock_token_contract.functions.balanceOf(
                securities_wallet
            ).call(),
            "tbd_symbol": tbd_contract.functions.symbol().call(),
            "securities_address": securities_wallet,
        }

    def get_all_clients(
        self,
        broker_contract_name: str,
        broker_contract_file_name: str,
        logger,
    ) -> list:
        """Returns a list of dictionaries with clients, tbdWallet,
        securitiesWallet as [(,,),] that are on Allowlist"""
        try:
            abi = self._load_abi_file(broker_contract_file_name)
            address = self.get_contract_address(broker_contract_name)
            contract = self.w3.eth.contract(address=address, abi=abi)
            return contract.functions.getAllClients().call()
        except Exception as e:
            logger.error(
                "Error during get_all_clients: %s, \nparams: broker_contract_name:"
                f"{broker_contract_name}\nbroker_contract_file_name: "
                f"{broker_contract_file_name}",
                e,
            )
            return None

    def update_order_book(self, logger):
        """Returns None, updates order book given caler_address"""
        try:
            order_book_contract = self.init_contract(
                name="Order Book", file_name="OrderBook"
            )
            bid_prices = order_book_contract.functions.getAllBuyOrders().call()
            ask_prices = order_book_contract.functions.getAllSellOrders().call()
            return bid_prices, ask_prices
        except Exception as e:
            logger.error("Error during update_order_book: %s", e)
            return None

    def update_account_orders(
        self, broker_contract_name, investor_identity_address, logger
    ):
        """Returns buy orders and sell order given investor_sec_address
        and broker_contract_address"""
        try:
            broker_contract = self.init_contract(
                name=broker_contract_name, file_name="Broker"
            )
            buy_orders = broker_contract.functions.getBuyOrders().call(
                {"from": investor_identity_address}
            )
            sell_orders = broker_contract.functions.getSellOrders().call(
                {"from": investor_identity_address}
            )
            return buy_orders, sell_orders
        except Exception as e:
            logger.error("Error during update_account_orders: %s", e)
            return None

    def get_money_wallet(self, all_clients_addresses, client_address, logger):
        """Returns money wallet given client address"""
        try:
            for client_data in all_clients_addresses:
                if client_data[0] == client_address:
                    return client_data[1]
            raise ValueError(f"Client address {client_address} not found.")
        except Exception as e:
            logger.error("Error during get_money_wallet: %s", e)
            return None

    def get_securities_wallet(self, all_clients_addresses, client_address, logger):
        """Returns security wallet given client address"""
        try:
            for client_data in all_clients_addresses:
                if client_data[0] == client_address:
                    return client_data[2]
            raise ValueError(f"Client address {client_address} not found.")
        except Exception as e:
            logger.error("Error during get_securities_wallet: %s", e)
            return None

    def grant_role(self, role, contract, privileged_address, caller_key, logger):
        """Returns none, grants a given role to the privileged address on a contract"""
        logger.info(
            "Granting %s role on %s to %s",
            role,
            contract.address,
            privileged_address,
        )
        hashed_role = Web3.keccak(text=role)
        tx_args_grant_role = [hashed_role, privileged_address]
        res_grant_role = self.do_contract_tx(
            "grantRole",
            tx_args_grant_role,
            caller_key=caller_key,
            logger=logger,
            contract=contract,
        )
        if res_grant_role["status"] == 1:
            logger.info("Granting role successful")
        else:
            logger.warning(
                "Warning: The grantRole transaction failed: %s", res_grant_role
            )

    def get_trade_history(self, sec_contract_address, logger):
        """Returns trade history in format:
        [{'secContrAddr':'value', 'sellerSecAddr':'value',
        'buyerSecAddr':'value', 'wholesaleValue':'value'}]"""
        try:
            dvp_contract_address = self.get_contract_address("Delivery vs Payment")
            dvp_events = []
            items = self._fetch_blockscout_logs(dvp_contract_address, logger)
            for item in items:
                decoded_info = item.get("decoded", {})
                if decoded_info is not None and decoded_info.get(
                    "method_call", ""
                ).startswith("DvPEvent"):
                    parameters = decoded_info.get("parameters", [])
                    event_data = {
                        param["name"]: param["value"]
                        for param in parameters
                        if param["name"]
                        in [
                            "secContrAddr",
                            "sellerSecAddr",
                            "buyerSecAddr",
                            "wholesaleValue",
                        ]
                    }
                    if (
                        sec_contract_address is None
                        or sec_contract_address == event_data["secContrAddr"]
                    ):
                        # Add block number to retrieve timestamp later
                        block_number = item.get("block_number")
                        event_data["block_number"] = block_number
                        event_data["timestamp"] = self._get_timestamp(
                            block_number, logger
                        )
                        dvp_events.append(event_data)
            return dvp_events
        except Exception as e:
            logger.error("Error during get_trade_history: %s", e)
            return None

    def _fetch_blockscout_logs(self, dvp_contract_address, logger):
        try:
            url = f"{c.BLOCKSCOUT_URL}/api/v2/addresses/{dvp_contract_address}/logs"
            r = requests.get(url, timeout=60)
            r.raise_for_status()
            return r.json().get("items", [])
        except requests.exceptions.RequestException as e:
            logger.error("HTTP request problem during fetching blockscout logs: %s", e)
            return None
        except ValueError as e:
            logger.error("Error parsing data during fetching blockscout logs: %s", e)
            return None

    def _get_timestamp(self, block_number, logger):
        try:
            url = f"{c.BLOCKSCOUT_URL}/api/v2/blocks/{block_number}"
            r = requests.get(url, timeout=60)
            r.raise_for_status()
            utc_timestamp = r.json().get("timestamp", "")
            return self.convert_to_cet(utc_timestamp, logger)
        except requests.exceptions.RequestException as e:
            logger.error("HTTP request problem during fetching block timestamp: %s", e)
            return None
        except ValueError as e:
            logger.error("Error parsing data during fetching block timestamp: %s", e)
            return None

    def convert_to_cet(self, utc_timestamp, logger):
        """Returns datetime object as CET given an UTC timestamp"""
        try:
            utc_dt = datetime.strptime(utc_timestamp, "%Y-%m-%dT%H:%M:%S.%fZ")
            cet = pytz.timezone("Europe/Paris")  # Central European Time
            cet_dt = utc_dt.astimezone(cet)
            return cet_dt.strftime("%Y-%m-%dT%H:%M:%S")
        except Exception as e:
            logger.error("Error converting timestamp: %s", e)
            return None
