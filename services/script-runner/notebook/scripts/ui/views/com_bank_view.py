import logging
from ipywidgets import (
    HTML,
    HBox,
    VBox,
    Button,
    Text,
    GridBox,
    Layout,
    Dropdown,
    BoundedIntText,
)
from scripts import config as c
from ..utils.view_utils import get_balances_html
from .view import View
from ..utils.database_utils import get_domain_for_address

logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(message)s")


class ComBankView(View):
    """
    Commercial Bank View is selectable by bank with cct functions,
    customer balances and allowlist components.

    CCT Functions: Transfer funds, mint and burn.
    Customer Balances: View all customers and their balances.
    Allowlist: Add and remove accouts to and from allowlist.
    """

    def __init__(self, w3, global_registry, title_style):
        super().__init__(w3, global_registry, title_style)

        self.selected_bank = None

        self.grid_items = {}
        self.grid_box = self._create_layout()
        self._update_kyc_table()

    def _create_layout(self):
        # bank_select_block
        bank_selector = Dropdown(options=list(c.com_banks.keys()), description="Bank")
        self.selected_bank = bank_selector.value
        bank_selector.observe(self._update_selected_bank, names="value")
        bank_select_block = VBox(
            [bank_selector], layout=Layout(grid_area="bank_select_block")
        )

        # mint_burn_block
        mint_burn_heading = HTML(
            f"<h2 style={self.title_style}>Mint / Burn</h2>",
        )
        mint_burn_account_input = Text(
            value="", placeholder="0x", description="Account"
        )
        mint_burn_amount_input = BoundedIntText(
            value=1000,
            min=0,
            max=1000000,
            step=1,
            description="Amount",
        )
        mint_button = Button(description="Mint TBD", button_style="")
        burn_button = Button(description="Burn TBD", button_style="")

        @mint_button.on_click
        def mint(button):
            bank = bank_selector.value
            address = self._validate_address(mint_burn_account_input.value)
            if not address:
                return
            amount = mint_burn_amount_input.value
            tx_args = (address, amount)
            self._process_bank_tbd_transaction(
                bank,
                "mint",
                tx_args,
                f"Minted {amount} to {address} ({bank})",
                button,
                self._update_kyc_table,
            )

        @burn_button.on_click
        def burn(button):
            bank = bank_selector.value
            address = self._validate_address(mint_burn_account_input.value)
            if not address:
                return
            amount = mint_burn_amount_input.value
            tx_args = (address, amount)
            self._process_bank_tbd_transaction(
                bank,
                "burn",
                tx_args,
                f"Burned {amount} from {address} ({bank})",
                button,
                self._update_kyc_table,
            )

        mint_burn_block = VBox(
            [
                mint_burn_heading,
                mint_burn_account_input,
                mint_burn_amount_input,
                HBox([mint_button, burn_button]),
            ],
            layout=Layout(grid_area="mint_burn_block"),
        )

        # kyc_block
        kyc_heading = HTML(
            f"<h2 style={self.title_style}>KYC List</h2>",
        )
        kyc_customer_address_input = Text(
            value="", placeholder="0x", description="Address"
        )
        kyc_add_button = Button(description="Add", button_style="success")
        kyc_remove_button = Button(description="Remove", button_style="danger")
        kyc_table = HTML()
        self.grid_items["kyc_table"] = kyc_table

        @kyc_add_button.on_click
        def add_customer_to_allowlist(button):
            address = self._validate_address(kyc_customer_address_input.value)
            if not address:
                return
            tx_args = (address,)
            self._process_bank_tbd_transaction(
                self.selected_bank,
                "add",
                tx_args,
                f"Added {address} to {self.selected_bank} Allowlist",
                button,
                self._update_kyc_table,
            )

        @kyc_remove_button.on_click
        def remove_customer_from_allowlist(button):
            address = self._validate_address(kyc_customer_address_input.value)
            if not address:
                return
            tx_args = (address,)
            self._process_bank_tbd_transaction(
                self.selected_bank,
                "remove",
                tx_args,
                f"Removed {address} from {self.selected_bank} Allowlist",
                button,
                self._update_kyc_table,
            )

        kyc_block = VBox(
            [
                kyc_heading,
                HBox(
                    [
                        kyc_customer_address_input,
                        kyc_add_button,
                        kyc_remove_button,
                    ]
                ),
                kyc_table,
            ],
            layout=Layout(grid_area="kyc_block"),
        )

        process_info_block = self._process_info_block()

        return GridBox(
            children=[
                bank_select_block,
                mint_burn_block,
                kyc_block,
                process_info_block,
            ],
            layout=Layout(
                width="100%",
                grid_template_rows="auto auto auto auto auto auto",
                grid_template_columns="100%",
                min_width="600px",
                max_width="700px",
                grid_template_areas="""
                'bank_select_block'
                'mint_burn_block'
                'kyc_block'
                'process_info_block'
                """,
            ),
        )

    def _update_selected_bank(self, change):
        if change["type"] == "change" and change["name"] == "value":
            self.selected_bank = change["new"]
            self._update_kyc_table()

    def _update_kyc_table(self):
        customers = []
        if self.selected_bank is not None:
            try:
                client = self._get_client_for_bank(self.selected_bank)
                allowlist = client.contract.functions.allowlistQueryAll().call()
                customers = [
                    [
                        get_domain_for_address(address),
                        address,
                        str(client.contract.functions.balanceOf(address).call()),
                    ]
                    for address in allowlist
                ]
            except Exception as e:
                self.logger.error("Error executing _update_kyc_table: %s", e)
        self.grid_items["kyc_table"].value = get_balances_html(
            customers, c.network["root_dns_zone"]
        )

    def periodic_update(self):
        """
        This function is called periodically by the ui to update the
        display of the customers / balances table.
        """
        self._update_kyc_table()
