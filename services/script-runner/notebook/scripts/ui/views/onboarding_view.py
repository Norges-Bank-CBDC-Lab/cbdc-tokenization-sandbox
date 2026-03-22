from ipywidgets import (
    HTML,
    HBox,
    VBox,
    Button,
    Text,
    GridBox,
    Layout,
    Dropdown,
)
from eth_account import Account
from scripts import config as c
from scripts.web3_client_handler import Web3ClientHandler
from .view import View
from ..utils.database_utils import insert_entry, check_if_exists

WIDGET_DESCRIPTION_WIDTH = "100px"

dropdown_kwargs = {"style": {"description_width": WIDGET_DESCRIPTION_WIDTH}}

eth_addr_text_kwargs = {
    "layout": Layout(width="450px"),
    "style": {"description_width": WIDGET_DESCRIPTION_WIDTH},
}


class OnboardingView(View):
    """
    The onboarding view is used to onboard a new user to the system.
    The onboarding consists of the following steps:
    - Create an address to hold TBD (ie become a customer at a bank).
    - Create an address to hold securities.
    - Create an address to become a customer at a broker.

    In the process, the addresses are added to the respective allowlists.
    """

    def __init__(self, w3, global_registry, title_style):
        super().__init__(w3, global_registry, title_style)

        self.grid_box = self._create_layout()
        self.contract_client = Web3ClientHandler(
            w3,
            global_registry,
            "TBD Nordea",
            "Tbd",  # refactor contract init in Web3ClientHandler in CBDCHYP-812
        )

    def _create_layout(self):
        # generate_addresses_block
        generate_addresses_heading = HTML(
            f"<h2 style={self.title_style}>Generate addresses</h2>"
        )
        generate_addresses_info = HTML(
            """
                Use the button below to generate two addresses:<br>
                <ul>
                <li> One to hold TBD.</li>
                <li> One to hold securities.</li>
                </ul>
                """
        )
        generate_addresses_tbd_address_output = Text(
            value="", description="TBD addr.", disabled=True, **eth_addr_text_kwargs
        )
        generate_addresses_securities_address_output = Text(
            value="",
            description="Securities addr.",
            disabled=True,
            **eth_addr_text_kwargs,
        )
        generate_addresses_button = Button(
            description="Generate addresses", button_style="success"
        )

        @generate_addresses_button.on_click
        def generate_addresses(_):
            # pylint: disable=unused-argument
            # pylint: disable=no-value-for-parameter
            tbd_address = Account.create().address
            securities_address = Account.create().address
            generate_addresses_tbd_address_output.value = tbd_address
            generate_addresses_securities_address_output.value = securities_address
            sign_up_with_bank_tbd_address_input.value = tbd_address
            sign_up_with_broker_tbd_address_input.value = tbd_address
            sign_up_with_broker_securities_address_input.value = securities_address

        generate_addresses_block = VBox(
            [
                generate_addresses_heading,
                generate_addresses_info,
                generate_addresses_tbd_address_output,
                HBox(
                    [
                        generate_addresses_securities_address_output,
                        generate_addresses_button,
                    ]
                ),
            ],
            layout=Layout(grid_area="generate_addresses_block"),
        )

        # sign_up_with_bank_block
        sign_up_with_bank_heading = HTML(
            f"<h2 style={self.title_style}>Sign up with bank</h2>"
        )

        sign_up_with_bank_info = HTML(
            """
            <p>
            When you sign up with a bank, your address will be added to its
            allowlist, thereby allowing you to perform transactions using TBD.
            You will automatically receive some initial funds.
            </p>
            """
        )

        bank_selector = Dropdown(
            options=list(c.com_banks.keys()), description="Bank", **dropdown_kwargs
        )

        sign_up_with_bank_tbd_address_input = Text(
            value="", placeholder="0x", description="TBD addr.", **eth_addr_text_kwargs
        )

        sign_up_with_bank_button = Button(description="Sign up", button_style="success")

        @sign_up_with_bank_button.on_click
        def sign_up_with_bank(_):
            # pylint: disable=unused-argument
            # pylint: disable=no-value-for-parameter
            tbd_address = sign_up_with_bank_tbd_address_input.value
            initial_funds_amount = 10000
            try:
                # add to allowlist
                self._process_bank_tbd_transaction(
                    bank_selector.value,
                    "add",
                    (tbd_address,),
                    f"Added {tbd_address} to {bank_selector.value} Allowlist",
                    sign_up_with_bank_button,
                )
                # mint
                self._process_bank_tbd_transaction(
                    bank_selector.value,
                    "mint",
                    (tbd_address, initial_funds_amount),
                    f"Minted {initial_funds_amount} to {tbd_address} ({bank_selector.value})",
                    sign_up_with_bank_button,
                )
            except Exception as e:
                self.logger.error("Error executing sign_up_with_bank: %s", e)

        sign_up_with_bank_block = VBox(
            [
                sign_up_with_bank_heading,
                sign_up_with_bank_info,
                bank_selector,
                HBox([sign_up_with_bank_tbd_address_input, sign_up_with_bank_button]),
            ],
            layout=Layout(grid_area="sign_up_with_bank_block"),
        )

        # sign_up_with_broker_block
        sign_up_with_broker_heading = HTML(
            f"<h2 style={self.title_style}>Sign up with broker</h2>"
        )

        sign_up_with_broker_info = HTML(
            """
            <p>
            When you sign up with a broker, you provide an address for funds (TBD) and
            one for securities (the ones created above). The broker then creates
            a third address through which it trades securities on your behalf.
            </p>
            """
        )

        broker_selector = Dropdown(
            options=list(c.brokers.keys()), description="Broker", **dropdown_kwargs
        )

        broker_bank_selector = Dropdown(
            options=list(c.com_banks.keys()), description="Bank", **dropdown_kwargs
        )
        sign_up_with_broker_investor_name_input = Text(
            value="",
            placeholder="Alice",
            description="Investor name",
            **eth_addr_text_kwargs,
        )

        sign_up_with_broker_tbd_address_input = Text(
            value="", placeholder="0x", description="TBD addr.", **eth_addr_text_kwargs
        )
        sign_up_with_broker_securities_address_input = Text(
            value="",
            placeholder="0x",
            description="Securities addr.",
            **eth_addr_text_kwargs,
        )

        sign_up_with_broker_button = Button(
            description="Sign up", button_style="success"
        )

        sign_up_with_broker_generated_address_info_template = """
        The generated broker customer address is: {broker_customer_address}
        """
        sign_up_with_broker_generated_address = HTML()

        @sign_up_with_broker_button.on_click
        def sign_up_with_broker(_):
            def success_action():
                insert_entry(
                    broker_customer_address,
                    str(sign_up_with_broker_investor_name_input.value) + ".id",
                )
                insert_entry(
                    tbd_address,
                    str(sign_up_with_broker_investor_name_input.value) + ".tbd",
                )
                insert_entry(
                    securities_address,
                    str(sign_up_with_broker_investor_name_input.value) + ".sec",
                )

            # pylint: disable=unused-argument
            # pylint: disable=no-value-for-parameter
            broker_customer_account = Account.create()
            c.add_broker_client_key(broker_customer_account)
            broker_customer_address = broker_customer_account.address
            tbd_address = sign_up_with_broker_tbd_address_input.value
            securities_address = sign_up_with_broker_securities_address_input.value
            tbd_contract_name = c.com_banks[broker_bank_selector.value]["contract_name"]
            tbd_contract_address = self.contract_client.get_contract_address(
                tbd_contract_name
            )
            tx_args = (
                broker_customer_address,
                tbd_address,
                securities_address,
                tbd_contract_address,
            )
            # check name service entries
            name_or_address_exists = check_if_exists(
                str(broker_customer_address),
                sign_up_with_broker_investor_name_input.value,
            )
            if name_or_address_exists:
                self.logger.error("Name or ID-Wallet already exists.")
                return
            try:
                # add to allowlist
                self._process_broker_transaction(
                    broker_selector.value,
                    "addClient",
                    tx_args,
                    f"Added {tx_args}, to {broker_selector.value} Allowlist",
                    sign_up_with_broker_button,
                    success_action=success_action,
                )

                sign_up_with_broker_generated_address.value = (
                    sign_up_with_broker_generated_address_info_template.format(
                        broker_customer_address=broker_customer_address,
                    )
                )
            except Exception as e:
                self.logger.error("Error executing sign_up_with_broker: %s", e)

        sign_up_with_broker_block = VBox(
            [
                sign_up_with_broker_heading,
                sign_up_with_broker_info,
                broker_bank_selector,
                broker_selector,
                sign_up_with_broker_investor_name_input,
                sign_up_with_broker_tbd_address_input,
                HBox(
                    [
                        sign_up_with_broker_securities_address_input,
                        sign_up_with_broker_button,
                    ]
                ),
                sign_up_with_broker_generated_address,
            ],
            layout=Layout(grid_area="sign_up_with_broker_block"),
        )

        # next_steps_info_block
        next_steps_info_heading = HTML(f"<h2 style={self.title_style}>Next steps</h2>")

        next_steps_info = HTML(
            """
            To be able to trade stocks, you need to add your securities address
            to the stock's allowlist, via the "Issuer" tab.<br>

            In the "Broker" tab, select the broker customer address from the
            dropdown labeled "Customer".
            """
        )

        next_steps_info_block = VBox(
            [
                next_steps_info_heading,
                next_steps_info,
            ],
            layout=Layout(grid_area="next_steps_info_block"),
        )

        process_info_block = self._process_info_block()

        return GridBox(
            children=[
                generate_addresses_block,
                sign_up_with_bank_block,
                sign_up_with_broker_block,
                next_steps_info_block,
                process_info_block,
            ],
            layout=Layout(
                width="100%",
                grid_template_rows="auto auto auto",
                grid_template_columns="100%",
                min_width="600px",
                max_width="700px",
                grid_template_areas="""
                'generate_addresses_block'
                'sign_up_with_bank_block'
                'sign_up_with_broker_block'
                'next_steps_info_block'
                'process_info_block'
                """,
            ),
        )
