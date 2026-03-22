import logging
from ipywidgets import (
    HTML,
    HBox,
    VBox,
    Layout,
)
from web3 import Web3
from scripts import config as c
from scripts.web3_client_handler import Web3ClientHandler
from ..utils.outputwidgethandler import OutputWidgetHandler

logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(message)s")


class View:
    """
    Base class for views that can be used in the ui.
    """

    def __init__(self, w3, global_registry, title_style):
        self.w3 = w3
        self.global_registry = global_registry
        self.title_style = title_style

        self.logger = logging.getLogger(__name__)
        self.logger.setLevel(logging.INFO)

    def periodic_update(self):
        """
        This function is called periodically by the ui and can be
        modified to update the display of elements in this view.
        """
        return

    def _process_info_block(self):
        log_output = OutputWidgetHandler()
        log_output.setFormatter(
            logging.Formatter("%(asctime)s - [%(levelname)s] %(message)s")
        )
        self.logger.addHandler(log_output)

        heading = HTML(
            f"<h2 style={self.title_style}>Process Info</h2>",
        )
        log_output_box = HBox(
            [log_output.widget],
            layout=Layout(
                width="auto",
                height="200px",
                overflow="auto",
                border="1px solid lightgrey",
            ),
        )

        return VBox(
            [heading, log_output_box],
            layout=Layout(width="auto", grid_area="process_info_block"),
        )

    def _get_key_for_bank(self, bank_name):
        try:
            return c.banks[bank_name]["account"].key
        except Exception:
            self.logger.error("Error getting key for selected bank")
            return None

    def _get_client_for_bank(self, bank_name):
        try:
            return Web3ClientHandler(
                self.w3,
                self.global_registry,
                c.banks[bank_name]["contract_name"],
                c.banks[bank_name]["file_name"],
            )
        except Exception:
            self.logger.error("Error getting client for selected bank")
            return None

    def _get_wnok_client(self):
        try:
            return Web3ClientHandler(
                self.w3,
                self.global_registry,
                c.banks[c.CENTRAL_BANK]["contract_name"],
                c.banks[c.CENTRAL_BANK]["file_name"],
            )
        except Exception:
            self.logger.error("Error getting wnok client")
            return None

    def _process_bank_tbd_transaction(
        self,
        bank_name,
        function_name,
        tx_args,
        log_message,
        b,
        success_action=None,
    ):
        """Execute the specified tbd transaction for the currently selected bank."""
        key = self._get_key_for_bank(bank_name)
        client = self._get_client_for_bank(bank_name)
        try:
            self._process_transaction(
                key,
                client,
                function_name,
                tx_args,
                log_message,
                b,
                success_action,
            )
        except Exception as e:
            self.logger.error("Error executing _process_bank_tbd_transaction: %s", e)

    def _process_bank_wnok_transaction(
        self,
        bank_name,
        function_name,
        tx_args,
        log_message,
        b,
        success_action=None,
    ):
        """Execute the specified wnok transaction for the currently selected bank."""
        key = self._get_key_for_bank(bank_name)
        client = self._get_wnok_client()
        try:
            self._process_transaction(
                key,
                client,
                function_name,
                tx_args,
                log_message,
                b,
                success_action,
            )
        except Exception as e:
            self.logger.error("Error executing _process_bank_wnok_transaction: %s", e)

    def _get_client_for_stockfactory(self):
        try:
            return Web3ClientHandler(
                self.w3,
                self.global_registry,
                c.STOCKFACTORY_CONTRACT_NAME,
                "StockTokenFactory",
            )
        except Exception:
            self.logger.error("Error getting client for stockfactory")
            return None

    def _process_stockfactory_transaction(
        self,
        function_name,
        tx_args,
        log_message,
        b,
        success_action=None,
    ):
        """Execute the specified transaction for the CSD."""
        key = c.PK_CSD.key
        client = self._get_client_for_stockfactory()
        self._process_transaction(
            key,
            client,
            function_name,
            tx_args,
            log_message,
            b,
            success_action,
        )

    def _process_csd_stocktoken_transaction(
        self,
        isin,
        function_name,
        tx_args,
        log_message,
        b,
        success_action=None,
    ):
        """Execute the specified transaction for the CSD."""
        key = c.PK_CSD.key
        client = self._get_client_for_stockfactory()
        stocktoken_contract, _ = client.get_stock_token_contract(isin)
        try:
            b.disabled = True
            res = client.do_contract_tx(
                function_name, tx_args, key, self.logger, stocktoken_contract
            )
            if res["status"] == 1:
                self.logger.info(log_message)
                if success_action:
                    success_action()
            else:
                self.logger.warning(
                    "Warning: The transaction failed (%s): %s", function_name, res
                )
        except Exception as e:
            self.logger.error("Error during %s: %s", function_name, e)
        finally:
            b.disabled = False

    def _get_client_for_orderbook(self):
        try:
            return Web3ClientHandler(
                self.w3,
                self.global_registry,
                c.ORDERBOOK_CONTRACT_NAME,
                "OrderBook",
            )
        except Exception:
            self.logger.error("Error getting client for stockfactory")
            return None

    def _place_ipo_sell_orders(self, isin, supply, price, button):
        stockfactory_client = self._get_client_for_stockfactory()
        stock_contract, stock_contract_address = (
            stockfactory_client.get_stock_token_contract(isin)
        )
        # currently we can use any client for get_contract as this uses the global registry
        # but it is confusing, so better to refactor this
        _, dvp_contract_address = stockfactory_client.get_contract(
            c.DVP_CONTRACT_NAME, "DvP"
        )
        order_book_contract, order_book_contract_address = (
            stockfactory_client.get_contract(c.ORDERBOOK_CONTRACT_NAME, "OrderBook")
        )
        _, tbd_contract_address = stockfactory_client.get_contract(
            c.TBD_DNB_CONTRACT_NAME, "Tbd"
        )
        stockfactory_client.grant_role(
            "CUSTODIAL_TRANSFER_ROLE",
            stock_contract,
            dvp_contract_address,
            c.PK_CSD.key,
            self.logger,
        )

        tx_args = (
            supply,
            price,
            stock_contract_address,
            tbd_contract_address,
            c.PK_CSD.address,
            c.PK_CSD.address,
        )
        orderbook_client = self._get_client_for_orderbook()
        self._process_transaction(
            c.PK_CSD.key,
            orderbook_client,
            "initializeSellOrders",
            tx_args,
            f"Initialized sell orders ({supply}, {price})",
            button,
        )

    def _get_key_for_broker(self, broker_name):
        try:
            return c.brokers[broker_name]["broker_key"]
        except Exception:
            self.logger.error("Error getting key for selected broker")
            return None

    def _get_client_for_broker(self, broker_name):
        try:
            return Web3ClientHandler(
                self.w3,
                self.global_registry,
                c.brokers[broker_name]["broker_contract_name"],
                "Broker",
            )
        except Exception:
            self.logger.error("Error getting client for selected bank")
            return None

    def _process_broker_transaction(
        self,
        broker_name,
        function_name,
        tx_args,
        log_message,
        b,
        success_action=None,
    ):
        """Execute the specified transaction for the currently selected broker."""
        key = self._get_key_for_broker(broker_name)
        client = self._get_client_for_broker(broker_name)
        self._process_transaction(
            key,
            client,
            function_name,
            tx_args,
            log_message,
            b,
            success_action,
        )

    def _process_broker_customer_transaction(
        self,
        broker_name,
        customer_address,
        function_name,
        tx_args,
        log_message,
        b,
        success_action=None,
    ):
        """Execute the specified transaction for the currently selected broker."""
        key = c.broker_client_keys[customer_address]
        client = self._get_client_for_broker(broker_name)
        self._process_transaction(
            key,
            client,
            function_name,
            tx_args,
            log_message,
            b,
            success_action,
        )

    def _process_transaction(
        self,
        key,
        client,
        function_name,
        tx_args,
        log_message,
        b,
        success_action=None,
    ):
        """Execute the specified transaction. Meanwhile, disable the action button.
        Use logger for output."""
        try:
            b.disabled = True
            res = client.do_contract_tx(
                function_name, tx_args, key, self.logger, client.contract
            )
            if res["status"] == 1:
                self.logger.info(log_message)
                if success_action:
                    success_action()
            else:
                self.logger.warning(
                    "Warning: The transaction failed (%s): %s", function_name, res
                )
        except Exception as e:
            self.logger.error("Error during %s: %s", function_name, e)
        finally:
            b.disabled = False

    def _validate_address(self, address):
        try:
            return Web3.to_checksum_address(address)
        except ValueError as ve:
            self.logger.error("Invalid address format: %s", ve)
            return None
