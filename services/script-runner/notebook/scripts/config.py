import os
from eth_account import Account
from web3 import Web3


BLOCKSCOUT_URL = (
    "http://blockscout-blockscout-stack-blockscout-svc.blockscout.svc.cluster.local:80"
)

network = {
    "http_rpc_url": os.environ["NETWORK_HTTP_RPC_URL"],
    "root_dns_zone": os.environ["ROOT_DNS_ZONE"],
}

database_url = os.environ["DATABASE_URL"]

# Load PK_ environment variables as Accounts
for key, value in os.environ.items():
    if key.startswith("PK_"):
        globals()[key] = Account().from_key(private_key=value)
    else:
        globals()[key] = value.replace('"', "")

with open("/work/registry-contract/address", "r", encoding="utf-8") as f:
    registry_contract_address = Web3.to_checksum_address(f.read())

# Supported banks
CENTRAL_BANK = "Norges Bank"

banks = {
    CENTRAL_BANK: {
        "display_name": "Norges Bank",
        "account": globals()["PK_NORGES_BANK"],
        "contract_name": os.environ["WNOK_CONTRACT_NAME"].replace('"', ""),
        "file_name": "Wnok",
    },
    "DNB": {
        "display_name": "DNB",
        "account": globals()["PK_DNB"],
        "contract_name": os.environ["TBD_DNB_CONTRACT_NAME"].replace('"', ""),
        "file_name": "Tbd",
    },
    "Nordea": {
        "display_name": "Nordea",
        "account": globals()["PK_NORDEA"],
        "contract_name": os.environ["TBD_NORDEA_CONTRACT_NAME"].replace('"', ""),
        "file_name": "Tbd",
    },
}

bank_keys = {b["account"].address: b["account"].key for b in banks.values()}
bank_names = {b["account"].address: key for key, b in banks.items()}

com_banks = {
    bank_name: bank
    for bank_name, bank in banks.items()
    if not bank_name == CENTRAL_BANK
}

brokers = {
    "DNB Carnegie": {
        "broker_contract_name": globals()["BROKER2_CONTRACT_NAME"],
        "broker_address": globals()["PK_BROKER2"].address,
        "broker_key": globals()["PK_BROKER2"].key,
    },
    "Pareto": {
        "broker_contract_name": globals()["BROKER1_CONTRACT_NAME"],
        "broker_address": globals()["PK_BROKER1"].address,
        "broker_key": globals()["PK_BROKER1"].key,
    },
}

other_market_participants = {
    "Market Maker": {
        "securities_address": globals()["PK_MARKET_MAKER"].address,
    },
    "CSD": {
        "securities_address": globals()["PK_CSD"].address,
    },
}

broker_client_keys = {}


def add_broker_client_key(broker_client_account):
    """Add a public / private key pair to the dictionary."""
    broker_client_keys[broker_client_account.address] = broker_client_account.key


add_broker_client_key(globals()["PK_ID_WALLET_ALICE"])
add_broker_client_key(globals()["PK_ID_WALLET_BOB"])
