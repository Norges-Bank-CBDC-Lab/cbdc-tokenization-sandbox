from ipywidgets import (
    HTML,
    VBox,
    HBox,
    Button,
    Text,
    BoundedIntText,
    GridBox,
    Layout,
    Dropdown,
)
from scripts import config as c
from ..utils.view_utils import get_allowlist_html, get_listings_html
from .view import View


# Max value for supply is limited by gas required to place initial sell orders
# Value higher than 10_000 take a long time to finalize
# Both limitations would be solved by allowing order lot sizes greater than 1
# Besides, these limits are convenient for test purposes, as it ensures that
# the initial liquidity is enough to trade the securities
SUPPLY_MIN_VALUE = 1
SUPPLY_MAX_VALUE = 1_000

PRICE_MIN_VALUE = 1
PRICE_MAX_VALUE = 10_000


class IssuerView(View):
    """
    Issuer View lets the issuer issue tokens and view all available listings.
    """

    def __init__(self, w3, global_registry, title_style):
        super().__init__(w3, global_registry, title_style)

        self.selected_isin = None

        self.grid_items = {}
        self.grid_box = self._create_layout()
        self._update_listings_table()

    def _create_layout(self):
        # ipo_block
        ipo_heading = HTML(
            f"<h2 style={self.title_style}>Initial Public Offering</h2>",
        )
        ipo_name_input = Text(placeholder="EquiNor", description="Name")
        ipo_symbol_input = Text(placeholder="EQNR", description="Symbol")
        ipo_isin_input = Text(placeholder="NO0001234567", description="ISIN")
        ipo_supply_input = BoundedIntText(
            value=1,
            min=SUPPLY_MIN_VALUE,
            max=SUPPLY_MAX_VALUE,
            description="Init. Supply",
        )
        ipo_price_input = BoundedIntText(
            value=1,
            min=PRICE_MIN_VALUE,
            max=PRICE_MAX_VALUE,
            description="Listing Price",
        )
        ipo_issuer_name_input = Text(
            value="",
            placeholder="EquiNor ASA",
            description="Issuer Name",
            disabled=False,
        )
        ipo_description_input = Text(
            value="",
            placeholder="Publicly traded stocks from EquiNor",
            description="Description",
            disabled=False,
        )
        ipo_issue_button = Button(
            description="Issue and List Token", button_style="success"
        )

        @ipo_issue_button.on_click
        def issue_and_list_token(button):
            name = str(ipo_name_input.value)
            symbol = str(ipo_symbol_input.value)
            isin = str(ipo_isin_input.value)
            supply = int(ipo_supply_input.value)
            price = int(ipo_price_input.value)
            description = str(ipo_description_input.value)
            issuer_name = str(ipo_issuer_name_input.value)

            if isin in self._get_client_for_stockfactory().get_all_isins():
                self.logger.error("ISIN %s is already listed.", isin)
                return

            tx_args = (
                name,
                symbol,
                isin,
                supply,
                description,
                issuer_name,
            )
            self._process_stockfactory_transaction(
                "createStockToken",
                tx_args,
                f"Issued and listed Token ({symbol}, {isin})",
                button,
            )
            self._place_ipo_sell_orders(isin, supply, price, button)

            self._update_listings_table()

        ipo_block = VBox(
            [
                ipo_heading,
                ipo_name_input,
                ipo_symbol_input,
                ipo_isin_input,
                ipo_supply_input,
                ipo_price_input,
                ipo_issuer_name_input,
                ipo_description_input,
                ipo_issue_button,
            ]
        )

        # allowlist_block
        allowlist_heading = HTML(
            f"<h2 style={self.title_style}>Stock Token Allowlist</h2>",
        )
        allowlist_stock_selector = Dropdown(
            options=[],
            description="Select ISIN",
        )
        self.selected_isin = allowlist_stock_selector.value
        allowlist_stock_selector.observe(self._update_selected_isin, names="value")
        self.grid_items["allowlist_stock_selector"] = allowlist_stock_selector

        allowlist_address_input = Text(
            value="", placeholder="0x", description="Address"
        )
        allowlist_add_button = Button(description="Add", button_style="success")
        allowlist_remove_button = Button(description="Remove", button_style="danger")
        allowlist_table = HTML()
        self.grid_items["allowlist_table"] = allowlist_table

        @allowlist_add_button.on_click
        def add_address_to_allowlist(button):
            address = self._validate_address(allowlist_address_input.value)
            if not address:
                return
            allowlist = self._get_client_for_stockfactory().load_allowlist_with_names(
                self.selected_isin
            )
            if any(address == entry["address"] for entry in allowlist):
                self.logger.error(
                    "Address %s is already on the Allowlist of %s",
                    address,
                    self.selected_isin,
                )
                return

            tx_args = (address,)
            self._process_csd_stocktoken_transaction(
                self.selected_isin,
                "add",
                tx_args,
                f"Added {address} to Allowlist of {self.selected_isin}",
                button,
                self._update_allowlist_table,
            )

        @allowlist_remove_button.on_click
        def remove_address_from_allowlist(button):
            address = self._validate_address(allowlist_address_input.value)
            if not address:
                return
            allowlist = self._get_client_for_stockfactory().load_allowlist_with_names(
                self.selected_isin
            )
            if not any(address == entry["address"] for entry in allowlist):
                self.logger.error(
                    "Address %s was not found on the Allowlist of %s",
                    address,
                    self.selected_isin,
                )
                return

            tx_args = (address,)
            self._process_csd_stocktoken_transaction(
                self.selected_isin,
                "remove",
                tx_args,
                f"Removed {address} from Allowlist of {self.selected_isin}",
                button,
                self._update_allowlist_table,
            )

        allowlist_block = VBox(
            [
                allowlist_heading,
                allowlist_stock_selector,
                HBox(
                    [
                        allowlist_address_input,
                        allowlist_add_button,
                        allowlist_remove_button,
                    ]
                ),
                allowlist_table,
            ],
            layout=Layout(width="auto", grid_area="allowlist_block"),
        )

        # listings_block
        listings_heading = HTML(
            f"<h2 style={self.title_style}>Listed Stock Tokens</h2>",
        )
        listings_table = HTML()
        self.grid_items["listings_table"] = listings_table
        listings_block = VBox(
            [listings_heading, listings_table],
            layout=Layout(width="auto", grid_area="listings_block"),
        )

        process_info_block = self._process_info_block()

        return GridBox(
            children=[
                ipo_block,
                allowlist_block,
                listings_block,
                process_info_block,
            ],
            layout=Layout(
                width="100%",
                grid_template_rows="auto auto auto auto auto auto",
                grid_template_columns="35% 50%",
                grid_template_areas="""
                'ipo_block allowlist_block'
                'listings_block listings_block'
                'process_info_block process_info_block'
                """,
            ),
        )

    def _update_selected_isin(self, change):
        if change["type"] == "change" and change["name"] == "value":
            self.selected_isin = change["new"]
            self._update_allowlist_table()

    def _update_allowlist_table(self):
        allowlist = []
        if self.selected_isin is not None:
            allowlist = self._get_client_for_stockfactory().load_allowlist_with_names(
                self.selected_isin
            )
        self.grid_items["allowlist_table"].value = get_allowlist_html(allowlist)

    def _update_listings_table(self):
        try:
            isins = self._get_client_for_stockfactory().get_all_isins()

            allowlist_stock_selector = self.grid_items["allowlist_stock_selector"]

            allowlist_stock_selector.unobserve(
                self._update_selected_isin, names="value"
            )
            allowlist_stock_selector.options = isins
            allowlist_stock_selector.value = self.selected_isin
            allowlist_stock_selector.observe(self._update_selected_isin, names="value")

            listings = self._get_client_for_stockfactory().load_listings(self.logger)
            listings_html = get_listings_html(listings, c.network["root_dns_zone"])

            self.grid_items["listings_table"].value = listings_html
        except Exception as e:
            self.logger.error("Error during _update_listings_table: %s", e)

    def periodic_update(self):
        """
        This function is called periodically by the ui to update the
        display of the issued stock tokens and allowlist.
        """
        self._update_allowlist_table()
        self._update_listings_table()
