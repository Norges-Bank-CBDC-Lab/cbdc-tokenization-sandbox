import time
from collections import defaultdict
import plotly.graph_objs as go
import pandas as pd
from ipywidgets import (
    Label,
    HTML,
    HBox,
    VBox,
    Button,
    GridBox,
    Layout,
    Output,
    Dropdown,
    BoundedIntText,
    SelectionSlider,
    ToggleButtons,
)
from IPython.display import display
from scripts import config as c
from scripts.web3_client_handler import Web3ClientHandler
from ..utils.view_utils import (
    get_order_book_html,
    get_customer_orders_html,
    get_trade_history_html,
)
from ..utils.database_utils import get_domain_for_address
from .view import View


# Value higher than 10_000 take a long time to finalize (cf IssuerView)
PRICE_MIN_VALUE = 1
PRICE_MAX_VALUE = 10_000


class BrokerView(View):
    """
    Broker View is selectable by ISIN with Managed Accounts and Limit Order Books section.

    Managed Accounts: shows Alice (Nordea) and Bob (DNB) retail investors and
    is used to place Buy/Sell orders.
    Limit Order Book: Displays all sell/buy limit prices and sizes.
    """

    def __init__(self, w3, global_registry, title_style):
        super().__init__(w3, global_registry, title_style)

        self.selected_broker = None
        self.selected_customer = None
        self.selected_stock = None

        # counter for periodic updates
        self._update_counter = 0

        # Utils functions
        self.contract_client = Web3ClientHandler(
            self.w3, self.global_registry, "TBD Nordea", "Tbd"
        )

        self.grid_items = {}
        self.grid_box = self._create_layout()

        # Initialize values
        self._update_isins()

        self._update_selected_broker(
            {
                "type": "change",
                "name": "value",
                "new": self.grid_items["broker_selector"].options[0],
            }
        )

        self.grid_items["stock_selector"].value = self.grid_items[
            "stock_selector"
        ].options[0]
        self._update_selected_stock(
            {
                "type": "change",
                "name": "value",
                "new": self.grid_items["stock_selector"].options[0],
            }
        )

        self._update_customer_info()

    def _create_layout(self):
        # selectors_block
        broker_selector = Dropdown(options=list(c.brokers.keys()), description="Broker")
        self.grid_items["broker_selector"] = broker_selector
        customer_selector = Dropdown(description="Customer")
        self.grid_items["customer_selector"] = customer_selector
        stock_selector = Dropdown(
            description="Stock ISIN",
        )
        self.grid_items["stock_selector"] = stock_selector

        selectors_block = VBox(
            [broker_selector, customer_selector, stock_selector],
            layout=Layout(grid_area="selectors_block"),
        )

        broker_selector.observe(self._update_selected_broker, names="value")
        customer_selector.observe(self._update_selected_customer, names="value")
        stock_selector.observe(self._update_selected_stock, names="value")

        # customer_info_block
        customer_info_heading = HTML(
            f"<h2 style={self.title_style}>Customer Account</h2>",
        )
        customer_info = HTML()
        self.grid_items["customer_info"] = customer_info
        customer_info_block = VBox([customer_info_heading, customer_info])

        # stock_info_block
        stock_info_heading = HTML(
            f"<h2 style={self.title_style}>Stock Details</h2>",
        )
        stock_info = HTML()
        self.grid_items["stock_info"] = stock_info
        stock_info_block = VBox(
            [stock_info], layout=Layout(grid_area="stock_info_block")
        )

        # customer_orders_block
        customer_orders_heading = HTML(
            f"<h2 style={self.title_style}>Open Orders (Customer)</h2>",
        )
        customer_orders_table = HTML()
        self.grid_items["customer_orders_table"] = customer_orders_table
        customer_orders_block = VBox(
            [customer_orders_heading, customer_orders_table],
            layout=Layout(grid_area="customer_orders_block"),
        )

        # customer_trade_history_block
        customer_trade_history_heading = HTML(
            f"<h2 style={self.title_style}>Trade History (Customer)</h2>",
        )
        customer_trade_history_cap_slider = SelectionSlider(
            options=[10, 50, "All"],
            value=10,
            description="Num Entries",
            layout=Layout(width="250px"),
        )
        self.grid_items["customer_trade_history_cap_slider"] = (
            customer_trade_history_cap_slider
        )
        customer_trade_history_table = HTML()
        self.grid_items["customer_trade_history_table"] = customer_trade_history_table
        customer_trade_history_cap_slider.observe(
            lambda _: self._update_trade_history(), names="value"
        )

        customer_trade_history_block = VBox(
            [
                customer_trade_history_heading,
                customer_trade_history_cap_slider,
                customer_trade_history_table,
            ],
            layout=Layout(grid_area="customer_trade_history_block"),
        )

        # stock_price_chart_block
        stock_price_chart_heading = HTML(
            f"<h2 style={self.title_style}>Stock price</h2>",
        )
        stock_price_chart_time_interval_selector = ToggleButtons(
            options=[
                "1m",
                "5m",
                "15m",
                "1H",
                "3H",
                "6H",
                "1D",
                "2D",
                "5D",
                "All",
            ],
            value="1D",
            button_style="",
            tooltips=[
                "1 minute",
                "5 minutes",
                "15 minutes",
                "1 hour",
                "3 hours",
                "6 hours",
                "1 day",
                "2 days",
                "5 days",
                "All",
            ],
            style={"button_width": "50px"},
        )
        stock_price_chart_time_interval_selector.observe(
            lambda _: self._update_trade_history(), names="value"
        )
        self.grid_items["stock_price_chart_time_interval_selector"] = (
            stock_price_chart_time_interval_selector
        )
        stock_price_chart_refresh_button = Button(
            description="Refresh", button_style="", layout=Layout(width="80px")
        )
        stock_price_chart_refresh_button.on_click(
            lambda _: self._update_trade_history()
        )
        stock_price_chart = Output()
        self.grid_items["stock_price_chart"] = stock_price_chart
        stock_price_chart_block = VBox(
            [
                stock_price_chart_heading,
                HBox(
                    [
                        stock_price_chart_time_interval_selector,
                        stock_price_chart_refresh_button,
                    ]
                ),
                stock_price_chart,
            ],
            layout=Layout(grid_area="stock_price_chart_block"),
        )

        # order_book_block
        order_book_heading = HTML(
            f"<h2 style={self.title_style}>Limit Order Book</h2>",
        )
        order_book_table = HTML(layout=Layout(width="40%"))
        self.grid_items["order_book_table"] = order_book_table
        order_book_block = VBox(
            [order_book_heading, order_book_table],
            layout=Layout(width="auto", grid_area="order_book_block"),
        )

        # stock_ops_block
        stock_ops_price_input = BoundedIntText(
            value=1,
            min=PRICE_MIN_VALUE,
            max=PRICE_MAX_VALUE,
            description="Price:",
            layout=Layout(width="180px"),
        )
        stock_ops_price_label = Label(value="NOK", layout=Layout(width="50px"))
        stock_ops_buy_button = Button(
            description="Buy", button_style="success", layout=Layout(width="70px")
        )
        stock_ops_sell_button = Button(
            description="Sell", button_style="danger", layout=Layout(width="70px")
        )

        stock_ops_revoke_order_id_selector = Dropdown(description="Revoke Order")
        self.grid_items["stock_ops_revoke_order_id_selector"] = (
            stock_ops_revoke_order_id_selector
        )
        stock_ops_revoke_order_button = Button(
            description="Revoke", button_style="", layout=Layout(width="80px")
        )

        @stock_ops_buy_button.on_click
        def place_buy_order(button):
            def success_action():
                self._update_customer_info()
                self._update_order_book_table()
                self._update_customer_orders()
                time.sleep(3)  # give Blockscout some time to index
                self._update_trade_history()

            _, security_contract_address = (
                self.contract_client.get_stock_token_contract(
                    self.selected_stock["isin"]
                )
            )
            amount = 1
            bid_price = int(stock_ops_price_input.value)
            tx_args = (security_contract_address, amount, bid_price)
            self._process_broker_customer_transaction(
                self.selected_broker,
                self.selected_customer["id_address"],
                "buy",
                tx_args,
                f"{self.selected_broker} placed a limit buy order "
                + f'on behalf of {self.selected_customer["id_address"]} - '
                + f'[{self.selected_stock["symbol"]}], size={amount}, bid price={bid_price} NOK',
                button,
                success_action,
            )

        @stock_ops_sell_button.on_click
        def place_sell_order(button):
            def success_action():
                self._update_customer_info()
                self._update_order_book_table()
                self._update_customer_orders()
                time.sleep(3)  # give Blockscout some time to index
                self._update_trade_history()

            _, security_contract_address = (
                self.contract_client.get_stock_token_contract(
                    self.selected_stock["isin"]
                )
            )
            amount = 1
            ask_price = int(stock_ops_price_input.value)
            tx_args = (security_contract_address, amount, ask_price)
            self._process_broker_customer_transaction(
                self.selected_broker,
                self.selected_customer["id_address"],
                "sell",
                tx_args,
                f"{self.selected_broker} placed a limit sell order "
                + f'on behalf of {self.selected_customer["id_address"]} - '
                + f'[{self.selected_stock["symbol"]}], size={amount}, ask price={ask_price} NOK',
                button,
                success_action,
            )

        @stock_ops_revoke_order_button.on_click
        def revoke_order(button):
            def success_action():
                self._update_customer_info()
                self._update_order_book_table()
                self._update_customer_orders()

            order = stock_ops_revoke_order_id_selector.value
            order_id = order["id"]
            order_type = order["type"]
            tx_args = (order_id,)
            if order_type == "buy":
                function_name = "revokeBuyOrder"
            elif order_type == "sell":
                function_name = "revokeSellOrder"
            else:
                self.logger.error(
                    "Error during revoke_order: Unknown order type %s", order_type
                )
                return
            self._process_broker_customer_transaction(
                self.selected_broker,
                self.selected_customer["id_address"],
                function_name,
                tx_args,
                f"Revoked {order_type} order with id {bytes.hex(order_id)}",
                button,
                success_action,
            )

        stock_ops_block = VBox(
            [
                HBox(
                    [
                        stock_ops_price_input,
                        stock_ops_price_label,
                        stock_ops_buy_button,
                        stock_ops_sell_button,
                    ]
                ),
                HBox(
                    [stock_ops_revoke_order_id_selector, stock_ops_revoke_order_button]
                ),
            ]
        )

        process_info_block = self._process_info_block()

        customer_column = VBox(
            [
                customer_info_block,
                stock_ops_block,
                customer_orders_block,
                customer_trade_history_block,
            ],
            layout=Layout(width="auto", grid_area="customer_column"),
        )

        stock_column = VBox(
            [stock_info_block, stock_price_chart_block, order_book_block],
            layout=Layout(width="auto", grid_area="stock_column"),
        )

        return GridBox(
            children=[
                selectors_block,
                customer_column,
                stock_column,
                process_info_block,
            ],
            layout=Layout(
                width="100%",
                grid_template_rows="auto auto auto",
                grid_template_columns="30% 10% 60%",
                grid_template_areas="""
                'selectors_block selectors_block selectors_block'
                'customer_column . stock_column'
                'process_info_block process_info_block process_info_block'
                """,
            ),
        )

    def _update_customer_orders(self):
        """Update both customer_orders_table and stock_ops_revoke_order_id_selector"""

        buy_orders_sorted = []
        sell_orders_sorted = []
        if self.selected_stock is not None and self.selected_customer is not None:
            broker_contract_name = c.brokers[self.selected_broker][
                "broker_contract_name"
            ]
            _, selected_sec_contract_address = (
                self.contract_client.get_stock_token_contract(
                    self.selected_stock["isin"]
                )
            )
            investor_identity_address = self.selected_customer["id_address"]
            buy_orders_raw, sell_orders_raw = (
                self.contract_client.update_account_orders(
                    broker_contract_name, investor_identity_address, self.logger
                )
            )
            buy_orders = []
            sell_orders = []
            for buy in buy_orders_raw:
                (
                    _id,
                    broker,
                    investor_sec_addr,
                    sec_contract_addr,
                    amount,
                    price,
                    investor_tbd_addr,
                    tbd_contr_addr,
                ) = buy
                id_hex = bytes.hex(_id)[
                    :5
                ]  # for better display only show first 5 chars
                if sec_contract_addr == selected_sec_contract_address:
                    buy_orders.append(
                        {
                            "id": _id,
                            "id_hex": id_hex,
                            "type": "buy",
                            "size": amount,
                            "price": price,
                        }
                    )
            for sell in sell_orders_raw:
                (
                    _id,
                    broker,
                    investor_sec_addr,
                    sec_contract_addr,
                    amount,
                    price,
                    investor_tbd_addr,
                    tbd_contr_addr,
                ) = sell
                id_hex = bytes.hex(_id)[
                    :5
                ]  # for better display only show first 5 chars
                if sec_contract_addr == selected_sec_contract_address:
                    sell_orders.append(
                        {
                            "id": _id,
                            "id_hex": id_hex,
                            "type": "sell",
                            "size": amount,
                            "price": price,
                        }
                    )
            buy_orders_sorted = sorted(buy_orders, key=lambda x: x["price"])
            sell_orders_sorted = sorted(sell_orders, key=lambda x: x["price"])

        # update customer_orders_table
        self.grid_items["customer_orders_table"].value = get_customer_orders_html(
            buy_orders_sorted, sell_orders_sorted
        )

        # update stock_ops_revoke_order_id_selector
        self.grid_items["stock_ops_revoke_order_id_selector"].options = [
            (bytes.hex(order["id"])[:5], order) for order in buy_orders_sorted
        ] + [(bytes.hex(order["id"])[:5], order) for order in sell_orders_sorted]

    def _update_trade_history(self):
        """Update both customer_trade_history_table and stock_price_chart"""
        customer_sec_address = ""
        trade_history = []
        if self.selected_stock is not None:
            try:
                _, selected_sec_contract_address = (
                    self.contract_client.get_stock_token_contract(
                        self.selected_stock["isin"]
                    )
                )
                trade_history = self.contract_client.get_trade_history(
                    selected_sec_contract_address, self.logger
                )
            except Exception as e:
                self.logger.error("Error during _update_trade_history: %s", e)

        if self.selected_customer is not None:
            customer_sec_address = self.selected_customer["securities_address"]

        # Update customer_trade_history_table
        limit = self.grid_items["customer_trade_history_cap_slider"].value
        if limit == "All":
            limit = len(trade_history)
        self.grid_items["customer_trade_history_table"].value = get_trade_history_html(
            trade_history[:limit], customer_sec_address
        )

        # update stock_price_chart
        fig = self._plot_historic_trades(
            trade_history,
            self.grid_items["stock_price_chart_time_interval_selector"].value,
        )
        self.grid_items["stock_price_chart"].clear_output(wait=True)
        with self.grid_items["stock_price_chart"]:
            display(fig)

    def _on_time_interval_change(self, change):
        if change["type"] == "change" and change["name"] == "value":
            self._update_trade_history()

    def _plot_historic_trades(self, trade_history, selected_interval):
        time_now_utc = pd.Timestamp.now().strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        time_now_cet_str = self.contract_client.convert_to_cet(
            time_now_utc, self.logger
        )
        time_now_cet = pd.to_datetime(time_now_cet_str)

        intervals = {
            "1m": pd.Timedelta(minutes=1),
            "5m": pd.Timedelta(minutes=5),
            "15m": pd.Timedelta(minutes=15),
            "1H": pd.Timedelta(hours=1),
            "3H": pd.Timedelta(hours=3),
            "6H": pd.Timedelta(hours=6),
            "1D": pd.Timedelta(days=1),
            "2D": pd.Timedelta(days=2),
            "5D": pd.Timedelta(days=5),
            # Arbitrarily large interval for "All"
            "All": pd.Timedelta(days=1000),
        }
        time_cutoff = time_now_cet - intervals[selected_interval]

        fig = go.Figure()

        if not trade_history or len(trade_history) == 0:
            fig.update_layout(
                xaxis_title="Timestamp",
                yaxis_title="Price [NOK]",
                title="No data yet, or error (make sure contracts have been deployed and verified)",
                template="plotly_white",
                width=800,
                height=500,
                xaxis={"range": [time_cutoff, time_now_cet]},
            )
        else:
            if selected_interval == "All":
                time_cutoff = pd.to_datetime(
                    min(trade["timestamp"] for trade in trade_history)
                )
            prices = [int(trade["wholesaleValue"]) for trade in trade_history]
            timestamps = [trade["timestamp"] for trade in trade_history]
            timestamps = pd.to_datetime(timestamps)
            trade_data = sorted(
                zip(timestamps, prices), key=lambda x: x[0]
            )  # sort timestamps
            sorted_timestamps, sorted_prices = zip(*trade_data)

            # Start with an initial color for the first point.
            previous_color = "black"

            # Add the first point explicitly.
            fig.add_trace(
                go.Scatter(
                    x=[sorted_timestamps[0]],
                    y=[sorted_prices[0]],
                    mode="markers",
                    marker={"color": previous_color},
                    hoverinfo="x+y",
                )
            )
            for i in range(1, len(sorted_prices)):
                x_pair = [sorted_timestamps[i - 1], sorted_timestamps[i]]
                y_pair = [sorted_prices[i - 1], sorted_prices[i]]
                # Determine color: green if increasing, red if decreasing, else previous color
                if sorted_prices[i] > sorted_prices[i - 1]:
                    color = "green"
                elif sorted_prices[i] < sorted_prices[i - 1]:
                    color = "red"
                else:
                    color = previous_color
                fig.add_trace(
                    go.Scatter(
                        x=x_pair,
                        y=y_pair,
                        mode="lines",
                        line={"color": color},
                        hoverinfo="x+y",
                    )
                )  # draw line
                fig.add_trace(
                    go.Scatter(
                        x=[x_pair[1]],
                        y=[y_pair[1]],
                        mode="markers",
                        marker={"color": color},
                        hoverinfo="x+y",
                    )
                )  # draw endpoint of the line as marker
                previous_color = color
            fig.update_layout(
                xaxis={"range": [time_cutoff, time_now_cet]},
                yaxis_title="Price [NOK]",
                template="plotly_white",
                yaxis={"range": [0, max(sorted_prices) + 1]},
                width=800,
                height=500,
                showlegend=False,
            )
        return fig

    def _update_selected_broker(self, change):
        if change["type"] == "change" and change["name"] == "value":
            self.selected_customer = None
            self.selected_broker = change["new"]
            self._update_customers()
            self.grid_items["customer_selector"].value = self.grid_items[
                "customer_selector"
            ].options[0][1]
            self._update_selected_customer(
                {
                    "type": "change",
                    "name": "value",
                    "new": self.grid_items["customer_selector"].value,
                }
            )

    def _update_selected_customer(self, change):
        if change["type"] == "change" and change["name"] == "value":
            # store the broker in a local variable, as the value of the selector could change
            # in the background and lead to retrieval of inconsistent data
            # similarly, store the information about the new selected customer in a
            # local variable and update the global value at once
            selected_broker = self.selected_broker
            self.selected_customer = None
            new_selected_customer = {}
            new_selected_customer["id_address"] = change["new"]
            try:
                tbd_contract_address = self.contract_client.get_tbd_contract_address(
                    self.contract_client.init_contract(
                        c.brokers[selected_broker]["broker_contract_name"],
                        "Broker",
                    ),
                    new_selected_customer["id_address"],
                )
                new_selected_customer["bank_contract_name"] = (
                    self.contract_client.get_contract_name(tbd_contract_address, "Tbd")
                )
                all_clients_addresses = self.contract_client.get_all_clients(
                    c.brokers[selected_broker]["broker_contract_name"],
                    "Broker",
                    self.logger,
                )
                new_selected_customer["securities_address"] = (
                    self.contract_client.get_securities_wallet(
                        all_clients_addresses,
                        new_selected_customer["id_address"],
                        self.logger,
                    )
                )
                self.selected_customer = new_selected_customer
            except Exception as e:
                self.logger.info("Error during _update_selected_customer: %s", e)

            self._update_customer_info()
            self._update_customer_orders()
            self._update_trade_history()

    def _update_selected_stock(self, change):
        if change["type"] == "change" and change["name"] == "value":
            self.selected_stock = self.contract_client.get_listing_info(change["new"])
            self._update_stock_info()
            self._update_customer_info()
            self._update_order_book_table()
            self._update_customer_orders()
            self._update_trade_history()

    def _update_customer_info(self):
        customer_info = {"balance": "", "tbd_symbol": "", "holdings": ""}
        stock_symbol = ""
        if self.selected_customer is not None and self.selected_stock is not None:
            customer_info = self.contract_client.get_account_info(
                c.brokers[self.selected_broker]["broker_contract_name"],
                self.selected_customer["bank_contract_name"],
                self.selected_customer["id_address"],
                self.selected_stock["isin"],
                self.logger,
            )
            stock_symbol = self.selected_stock["symbol"]
        self.grid_items[
            "customer_info"
        ].value = f"""
        Balance: {customer_info["balance"]} {customer_info["tbd_symbol"]}<br>
        Holdings: {customer_info["holdings"]} {stock_symbol}
        """

    def _update_order_book_table(self):
        broker_name_mapping = self._get_broker_contract_addresses_and_names()
        other_market_participants_name_mapping = (
            self._get_other_market_participants_addresses_and_names()
        )

        _, selected_sec_contract_address = (
            self.contract_client.get_stock_token_contract(self.selected_stock["isin"])
        )
        bids_raw, asks_raw = self.contract_client.update_order_book(self.logger)
        bids = []
        asks = []
        for bid in bids_raw:
            (
                _id,
                broker,
                investor_sec_addr,
                sec_contract_addr,
                amount,
                price,
                investor_tbd_addr,
                tbd_contr_addr,
            ) = bid
            if sec_contract_addr == selected_sec_contract_address:
                market_participant_name = broker_name_mapping.get(
                    broker,
                    other_market_participants_name_mapping.get(
                        investor_sec_addr, "Unknown"
                    ),
                )
                bids.append(
                    {
                        "price": price,
                        "amount": amount,
                        "market_participant": market_participant_name,
                    }
                )
        for ask in asks_raw:
            (
                _id,
                broker,
                investor_sec_addr,
                sec_contract_addr,
                amount,
                price,
                investor_tbd_addr,
                tbd_contr_addr,
            ) = ask
            if sec_contract_addr == selected_sec_contract_address:
                market_participant_name = broker_name_mapping.get(
                    broker,
                    other_market_participants_name_mapping.get(
                        investor_sec_addr, "Unknown"
                    ),
                )
                asks.append(
                    {
                        "price": price,
                        "amount": amount,
                        "market_participant": market_participant_name,
                    }
                )
        bids_sorted = sorted(bids, key=lambda x: x["price"])
        asks_sorted = sorted(asks, key=lambda x: x["price"])
        # group by amount
        bids_grouped = defaultdict(int)
        for bid in bids_sorted:
            bids_grouped[(bid["price"], bid["market_participant"])] += bid["amount"]
        asks_grouped = defaultdict(int)
        for ask in asks_sorted:
            asks_grouped[(ask["price"], ask["market_participant"])] += ask["amount"]
        bids_grouped_capped_rev_sorted = sorted(
            bids_grouped.items(), key=lambda x: x[0][0], reverse=True
        )[:10]
        bids_grouped_capped = sorted(
            bids_grouped_capped_rev_sorted, key=lambda x: x[0][0]
        )
        asks_grouped_capped = sorted(asks_grouped.items(), key=lambda x: x[0][0])[:10]
        # transform format
        bids = [
            {"price": price, "market_participant": market_participant, "amount": amount}
            for (price, market_participant), amount in bids_grouped_capped
        ]
        asks = [
            {"price": price, "market_participant": market_participant, "amount": amount}
            for (price, market_participant), amount in asks_grouped_capped
        ]
        self.grid_items["order_book_table"].value = get_order_book_html(bids, asks)

    def _get_broker_contract_addresses_and_names(self):
        broker_mapping = {}
        for name, info in c.brokers.items():
            broker_contract_name = info["broker_contract_name"]
            broker_address = self.contract_client.get_contract_address(
                broker_contract_name
            )
            broker_mapping[broker_address] = name
        return broker_mapping

    def _get_other_market_participants_addresses_and_names(self):
        return {
            info["securities_address"]: name
            for name, info in c.other_market_participants.items()
        }

    def _update_stock_info(self):
        self.grid_items[
            "stock_info"
        ].value = f"""
            <h2 style={self.title_style}>{self.selected_stock["name"]}
            [{self.selected_stock["symbol"]}] - {self.selected_stock["issuer_name"]}.
            {self.selected_stock["description"]}</h2>
        """

    def _update_isins(self):
        isins = self.contract_client.get_all_isins()

        self.grid_items["stock_selector"].unobserve(
            self._update_selected_stock, names="value"
        )
        self.grid_items["stock_selector"].options = isins
        if self.selected_stock is not None:
            self.grid_items["stock_selector"].value = self.selected_stock["isin"]
        self.grid_items["stock_selector"].observe(
            self._update_selected_stock, names="value"
        )

    def _update_customers(self):
        customers = self.contract_client.get_all_clients(
            c.brokers[self.selected_broker]["broker_contract_name"],
            "Broker",
            self.logger,
        )

        options = [
            (
                (
                    get_domain_for_address(c[0]).split(".")[0]
                    if get_domain_for_address(c[0])
                    else c[0]
                ),
                c[0],
            )
            for c in customers
        ]
        try:
            self.grid_items["customer_selector"].unobserve(
                self._update_selected_customer, names="value"
            )
        except ValueError:
            # if unobserve has been called from a different thread,
            # a value error is raised
            # in this case, we continue
            pass
        except Exception as e:
            raise e
        else:
            self.grid_items["customer_selector"].options = options
            self.grid_items["customer_selector"].observe(
                self._update_selected_customer, names="value"
            )

    def periodic_update(self):
        """
        This function is called periodically by the ui to update the
        display of the order book.
        """
        self._update_order_book_table()
        self._update_customer_info()
        self._update_customers()
        self._update_isins()

        # Perform slower periodic update every 10 cycles
        # if self._update_counter == 0:
        #     self._update_trade_history()
        # self._update_counter = (self._update_counter + 1) % 10
