import threading
import time

from ipywidgets import VBox, ToggleButtons, Output
from IPython.display import display

from scripts import config as c
from scripts import web3_client_handler as web3Client

from scripts.ui.views.onboarding_view import OnboardingView
from scripts.ui.views.broker_view import BrokerView
from scripts.ui.views.issuer_view import IssuerView
from scripts.ui.views.com_bank_view import ComBankView
from scripts.ui.views.norges_bank_view import NorgesBankView

ONBOARDING_VIEW = "Onboarding"
BROKER_VIEW = "Broker"
ISSUER_VIEW = "Issuer"
COM_BANK_VIEW = "Commercial Bank"
NORGES_BANK_VIEW = "Norges Bank"


class UI:
    """
    The main UI class to display interactive and dynamic views for Broker,
    Issuer, Commercial Banks and Norges Bank.
    """

    def __init__(self):
        # Web3 connection
        self.w3 = web3Client.get_w3_client()
        # Global registry
        with open(
            "contracts/GlobalRegistry.sol/GlobalRegistry.abi", "r", encoding="utf-8"
        ) as f:
            abi = "".join(f.read().splitlines())
        self.global_registry = self.w3.eth.contract(
            address=c.registry_contract_address, abi=abi
        )

        # Consistent style for all views
        title_style = "font-family: Arial, sans-serif; color: #333;"

        self.views = {
            ONBOARDING_VIEW: OnboardingView(self.w3, self.global_registry, title_style),
            BROKER_VIEW: BrokerView(self.w3, self.global_registry, title_style),
            ISSUER_VIEW: IssuerView(self.w3, self.global_registry, title_style),
            COM_BANK_VIEW: ComBankView(self.w3, self.global_registry, title_style),
            NORGES_BANK_VIEW: NorgesBankView(
                self.w3, self.global_registry, title_style
            ),
        }
        self.active_view = BROKER_VIEW

        toggle_buttons_views = ToggleButtons(
            options=[
                ONBOARDING_VIEW,
                BROKER_VIEW,
                ISSUER_VIEW,
                COM_BANK_VIEW,
                NORGES_BANK_VIEW,
            ],
            disabled=False,
            value=self.active_view,
            button_style="info",
        )

        self.output = Output()

        toggle_buttons_views.observe(self._on_toggle_change, names="value")

        # Display UI
        display(VBox([toggle_buttons_views, self.output]))
        with self.output:
            display(self.views[self.active_view].grid_box)

        # run a thread that periodically updates certain elements
        update_thread = threading.Thread(
            target=self._periodic_update, args=(0.5,), daemon=True
        )
        update_thread.start()

    def _on_toggle_change(self, change):
        with self.output:
            self.output.clear_output()
            if change["new"] in self.views:
                self.active_view = change["new"]
                display(self.views[self.active_view].grid_box)

    def _periodic_update(self, period):
        while True:
            self.views[self.active_view].periodic_update()
            time.sleep(period)
