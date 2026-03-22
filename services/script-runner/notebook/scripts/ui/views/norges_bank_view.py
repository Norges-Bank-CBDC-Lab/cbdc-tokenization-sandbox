import logging
from ipywidgets import HTML, HBox, VBox, Button, Text, GridBox, Layout, BoundedIntText
from scripts import config as c
from scripts.web3_client_handler import Web3ClientHandler
from ..utils.view_utils import get_balances_html
from .view import View
from ..utils.database_utils import insert_entry, delete_entry, check_if_exists

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(message)s")


class NorgesBankView(View):
    """
    Norges Bank View is selectable by bank with cct functions,
    commercial bank balances and allowlist components.

    CCT Functions: Transfer funds, mint and burn.
    Commercial Bank Balances: View all customers and their balances.
    Allowlist: Add and remove accouts to and from allowlist.
    """

    def __init__(self, w3, global_registry, title_style):
        super().__init__(w3, global_registry, title_style)

        # Utils function
        self.contract_client = Web3ClientHandler(
            self.w3, self.global_registry, "Wholesale NOK", "Wnok"
        )

        self.banks = self.contract_client.load_balances()
        self.allowlist = self.contract_client.load_allowlist()

        self.grid_items = {}
        self.grid_box = self._create_layout()

    def _create_layout(self):
        # transfer_block
        transfer_from_input = Text(value="", placeholder="0x", description="(From)")
        transfer_to_input = Text(value="", placeholder="0x", description="To")
        transfer_amount_input = BoundedIntText(
            value=10000,
            min=0,
            max=1000000,
            step=1,
            description="Amount",
        )
        transfer_funds_button = Button(description="Transfer Funds", button_style="")
        mint_button = Button(description="Mint wNOK", button_style="")
        burn_button = Button(description="Burn wNOK", button_style="")

        @transfer_funds_button.on_click
        def transfer_funds(button):
            from_address = self._validate_address(transfer_from_input.value)
            to_address = self._validate_address(transfer_to_input.value)
            if not from_address or not to_address:
                return
            amount = transfer_amount_input.value
            tx_args = (to_address, amount)
            log_message = (
                f"Transferred {amount} wNOK" f"from {from_address} to {to_address}"
            )
            self._process_bank_wnok_transaction(
                c.bank_names[from_address],
                "transfer",
                tx_args,
                log_message,
                button,
            )
            self._update_balances()

        @mint_button.on_click
        def mint(button):
            to_address = self._validate_address(transfer_to_input.value)
            if not to_address:
                return
            amount = transfer_amount_input.value
            tx_args = (to_address, amount)
            log_message = f"Minted {amount} wNOK @ {to_address}"
            self._process_bank_wnok_transaction(
                c.CENTRAL_BANK,
                "mint",
                tx_args,
                log_message,
                button,
            )
            self._update_balances()

        @burn_button.on_click
        def burn(button):
            to_address = self._validate_address(transfer_to_input.value)
            if not to_address:
                return
            amount = transfer_amount_input.value
            tx_args = (to_address, amount)
            log_message = f"Burned {amount} wNOK @ {to_address}"
            self._process_bank_wnok_transaction(
                c.CENTRAL_BANK,
                "burn",
                tx_args,
                log_message,
                button,
            )
            self._update_balances()

        transfer_block = VBox(
            [
                transfer_from_input,
                transfer_to_input,
                transfer_amount_input,
                HBox([transfer_funds_button, mint_button, burn_button]),
            ],
            layout=Layout(grid_area="transfer_block"),
        )

        # bank_registry_block
        bank_registry_heading = HTML(
            f"<h2 style={self.title_style}>Commercial Bank Registry</h2>",
        )
        bank_registry_bank_name_input = Text(
            value="", placeholder="Nordea Bank", description="Bank Name"
        )
        bank_registry_bank_address_input = Text(
            value="", placeholder="0x", description="Address"
        )
        bank_registry_add_button = Button(description="Add", button_style="success")
        bank_registry_remove_button = Button(
            description="Remove", button_style="danger"
        )
        bank_registry_table = HTML(
            value=get_balances_html(self.banks, c.network["root_dns_zone"]),
        )
        self.grid_items["bank_registry_table"] = bank_registry_table

        @bank_registry_add_button.on_click
        def add_bank_to_allowlist(button):
            def success_action():
                insert_entry(bank_address, bank_name)

            bank_name = bank_registry_bank_name_input.value.strip()
            bank_address = self._validate_address(
                bank_registry_bank_address_input.value
            )
            if not bank_address:
                return
            name_or_address_exists = check_if_exists(bank_address, bank_name)
            if name_or_address_exists:
                self.logger.info(
                    'Either bank name "%s" or address "%s"'
                    + "already exists in Allowlist",
                    bank_name,
                    bank_address,
                )
                bank_registry_add_button.disabled = False
                return
            tx_args = (bank_address,)
            log_message = f'Added "{bank_name}" @ "{bank_address}" to Allowlist'
            self._process_bank_wnok_transaction(
                c.CENTRAL_BANK,
                "add",
                tx_args,
                log_message,
                button,
                success_action=success_action,
            )
            self._update_balances()

        @bank_registry_remove_button.on_click
        def remove_bank_from_allowlist(button):
            def success_action():
                delete_entry(bank_address, bank_name)

            bank_name = bank_registry_bank_name_input.value.strip()
            bank_address = self._validate_address(
                bank_registry_bank_address_input.value
            )
            if not bank_address:
                return
            name_or_address_exists = check_if_exists(bank_address, bank_name)
            if name_or_address_exists:
                tx_args = (bank_address,)
                log_message = f"Removed {bank_name} ({bank_address}) from Allowlist"
                self._process_bank_wnok_transaction(
                    c.CENTRAL_BANK,
                    "remove",
                    tx_args,
                    log_message,
                    button,
                    success_action=success_action,
                )
                self._update_balances()
            else:
                self.logger.error(
                    'Bank "%s" with address "%s" not found in Allowlist',
                    bank_name,
                    bank_address,
                )
                bank_registry_remove_button.disabled = False

        bank_registry_block = VBox(
            [
                bank_registry_heading,
                HBox(
                    [
                        bank_registry_bank_name_input,
                        bank_registry_bank_address_input,
                        bank_registry_add_button,
                        bank_registry_remove_button,
                    ]
                ),
                bank_registry_table,
            ],
            layout=Layout(width="auto", grid_area="bank_registry_block"),
        )

        process_info_block = self._process_info_block()

        return GridBox(
            children=[
                transfer_block,
                bank_registry_block,
                process_info_block,
            ],
            layout=Layout(
                width="100%",
                grid_template_rows="auto auto auto auto",
                grid_template_columns="50%",
                grid_template_areas="""
                'transfer_block'
                'bank_registry_block'
                'process_info_block'
                """,
            ),
        )

    def _update_balances(self):
        try:
            banks = self.contract_client.load_balances()
            self.grid_items["bank_registry_table"].value = get_balances_html(
                banks, c.network["root_dns_zone"]
            )
        except Exception as e:
            self.logger.error("Error during _update_balances: %s", e)
