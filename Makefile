.PHONY: help build-contracts test-contracts verify-contracts fmt-contracts slither \
	sandbox-fresh-start sandbox-start sandbox-stop sandbox-delete sandbox-generate-config \
	infra-start infra-stop infra-delete infra-registry-start infra-registry-sync \
	api-lint api-format-check bens-openapi-regen \
	sandbox-local-fixtures \
	bid-tools-install bid-encrypt bid-encrypt-basic bid-submit bid-submit-basic bid-place bid-place-basic \
	require-bid-vars require-basic-bid-vars

BID_TYPE ?= initial
BID_BASIC_TYPE ?= example
BID_ENCRYPT_INPUT ?= .tmp/bid-encryption/examples/auctions/seal.$(BID_TYPE).json
BID_ENCRYPT_BASIC_INPUT ?= .tmp/bid-encryption/examples/basic/seal.$(BID_BASIC_TYPE).json
BID_ENCRYPT_OUTPUT ?= .tmp/bid-submitter/$(BID_TYPE).json
BID_ENCRYPT_BASIC_OUTPUT ?= .tmp/bid-encryption/examples/basic/sealed.json
BID_KEYS ?= scripts/bid-submitter/examples/bids.keys.json
BID_CHAIN_ID ?= 2018
BESU_RPC_URL ?= http://besu.cbdc-sandbox.local:8545
BOND_API_URL ?= http://bond-api.cbdc-sandbox.local
BID_BASIC_CONTEXT_DIR ?= .tmp
BID_BASIC_CONTEXT_FILE ?= $(BID_BASIC_CONTEXT_DIR)/bid-basic-context.$(AUCTION_ID).json

help:
	@echo "Targets:"
	@echo "  build-contracts    Build Solidity contracts (Foundry)"
	@echo "  test-contracts     Run Foundry tests"
	@echo "  verify-contracts   Run verification on blockscout for previously deployed contracts (uses contract broadcast directory)"
	@echo "  fmt-contracts      Format Solidity (forge fmt)"
	@echo "  slither            Run slither.sh (if configured)"
	@echo "  sandbox-fresh-start Run complete startup scripts for sandbox. (Will initiate local containers first, then sandbox)"
	@echo "  sandbox-start      Start sandbox (infra/services/contracts via sandbox.sh, make sure to have local containers running)"
	@echo "  sandbox-stop       Stop sandbox releases (keeps cluster/cache)"
	@echo "  sandbox-delete     Fully tear down kind cluster + cache"
	@echo "  sandbox-generate-config Generate .env.sandbox deploy flags"
	@echo "  infra-start        Start local infra (Kind + Helm)"
	@echo "  infra-stop         Stop local infra (keeps cluster/cache)"
	@echo "  infra-delete       Delete local infra (cluster teardown)"
	@echo "  infra-registry-start Start local registry container"
	@echo "  infra-registry-sync  Push configured images to local registry"
	@echo "  api-lint           Lint nb-bond-api (ESLint)"
	@echo "  api-format-check   Check formatting (Prettier)"
	@echo "  bens-openapi-regen Regenerate BENS OpenAPI server (FastAPI)"
	@echo "  sandbox-local-fixtures Generate deterministic local-only fixture files"
	@echo "  bid-tools-install  Install npm deps for bid CLIs"
	@echo "  bid-encrypt        Encrypt bids for a live auction using auction examples"
	@echo "  bid-encrypt-basic  Encrypt bids for a live auction using basic example"
	@echo "  bid-submit         Submit sealed bids on-chain"
	@echo "  bid-submit-basic   Submit basic sealed bids using bond-api context discovery"
	@echo "  bid-place          Encrypt + submit (depends on bid-encrypt, bid-submit)"
	@echo "  bid-place-basic    Encrypt + submit basic example using bond-api context discovery"
	@echo ""
	@echo "Bid variables:"
	@echo "  BOND_AUCTION       Required for bid-encrypt/bid-submit (0x...)"
	@echo "  AUCTION_ID         Required for all bid targets (bytes32 0x...)"
	@echo "  BID_TYPE           initial|extend|buyback (default: initial)"
	@echo "  BID_ENCRYPT_INPUT  Plaintext bid input file (default: generated under .tmp/)"
	@echo "  BID_ENCRYPT_OUTPUT Sealed bids output file (default: generated under .tmp/)"
	@echo "  BID_KEYS           Bidder private keys map for bid-submit (generated if missing)"
	@echo "  BID_CHAIN_ID       EIP-712 chain id for bid signing (default: 2018)"
	@echo "  BESU_RPC_URL       RPC URL for submissions (default: sandbox gateway)"
	@echo "  BOND_API_URL       bond-api base URL for basic targets (default: sandbox gateway)"
	@echo "  BID_BASIC_CONTEXT_FILE Cache file used by basic targets (auto-populated)"

build-contracts:
	@cd contracts && forge build

test-contracts:
	@cd contracts && forge test

verify-contracts:
	@cd contracts && ./contracts.sh verify-latest

fmt-contracts:
	@cd contracts && forge fmt

slither:
	@cd contracts && ./slither.sh

sandbox-fresh-start:
	@./sandbox.sh registry-start && ./sandbox.sh start

sandbox-start:
	@./sandbox.sh start

sandbox-stop:
	@./sandbox.sh stop

sandbox-delete:
	@./sandbox.sh delete

sandbox-generate-config:
	@./sandbox.sh generate-config

infra-start:
	@cd infra && ./infra.sh start

infra-stop:
	@cd infra && ./infra.sh stop

infra-delete:
	@cd infra && ./infra.sh delete

infra-registry-start:
	@cd infra && ./infra.sh registry-start

infra-registry-sync:
	@cd infra && ./infra.sh registry-sync

api-lint:
	@cd services/nb-bond-api && npm run lint

api-format-check:
	@cd services/nb-bond-api && npm run format:check

bens-openapi-regen:
	@cd services/blockscout/bens-microservice && ./regen-openapi.sh

sandbox-local-fixtures:
	@node ./scripts/generate-local-sandbox-fixtures.mjs

require-bid-vars:
	@if [ -z "$(BOND_AUCTION)" ] || [ -z "$(AUCTION_ID)" ]; then \
		echo "BOND_AUCTION and AUCTION_ID are required."; \
		echo "Example: make bid-place BOND_AUCTION=0x... AUCTION_ID=0x..."; \
		exit 1; \
	fi

require-basic-bid-vars:
	@if [ -z "$(AUCTION_ID)" ]; then \
		echo "AUCTION_ID is required."; \
		echo "Example: make bid-place-basic AUCTION_ID=0x..."; \
		exit 1; \
	fi
	@if ! command -v curl >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then \
		echo "curl and jq are required for basic bid targets."; \
		exit 1; \
	fi

bid-tools-install:
	@npm --prefix scripts/bid-encryption ci
	@npm --prefix scripts/bid-submitter ci

bid-encrypt: sandbox-local-fixtures require-bid-vars
	@mkdir -p "$(dir $(BID_ENCRYPT_OUTPUT))"
	@npm --prefix scripts/bid-encryption run encrypt -- "$(abspath $(BID_ENCRYPT_INPUT))" "$(abspath $(BID_ENCRYPT_OUTPUT))" \
		--chainId "$(BID_CHAIN_ID)" --verifyingContract "$(BOND_AUCTION)" --auctionId "$(AUCTION_ID)"

bid-encrypt-basic: sandbox-local-fixtures require-basic-bid-vars
	@set -eu; \
	health_json=$$(curl -fsS "$(BOND_API_URL)/v1/health"); \
	auction_json=$$(curl -fsS "$(BOND_API_URL)/v1/auctions/$(AUCTION_ID)"); \
	bond_manager=$$(printf '%s' "$$health_json" | jq -r '.bondManager'); \
	bond_auction=$$(printf '%s' "$$health_json" | jq -r '.bondAuction'); \
	sealing_public_key=$$(printf '%s' "$$health_json" | jq -r '.sealingPublicKey'); \
	auction_pub_key=$$(printf '%s' "$$auction_json" | jq -r '.metadata.auctionPubKey'); \
	auction_isin=$$(printf '%s' "$$auction_json" | jq -r '.isin'); \
	auction_status=$$(printf '%s' "$$auction_json" | jq -r '.status'); \
	if [ "$$bond_manager" = "null" ] || [ -z "$$bond_manager" ] || [ "$$bond_auction" = "null" ] || [ -z "$$bond_auction" ] || [ "$$auction_pub_key" = "null" ] || [ -z "$$auction_pub_key" ]; then \
		echo "Failed to resolve bid context from $(BOND_API_URL)."; \
		exit 1; \
	fi; \
	echo "Resolved basic bid context: auctionId=$(AUCTION_ID) isin=$$auction_isin status=$$auction_status bondManager=$$bond_manager bondAuction=$$bond_auction"; \
	if [ "$$sealing_public_key" != "$$auction_pub_key" ]; then \
		echo "Warning: sealingPublicKey differs from this auction's auctionPubKey; using auctionPubKey from auction metadata."; \
	fi; \
	mkdir -p "$(BID_BASIC_CONTEXT_DIR)"; \
	fetched_at=$$(date +%s); \
	printf '%s' "$$health_json" | jq --argjson auction "$$auction_json" --arg auctionId "$(AUCTION_ID)" --arg fetchedAt "$$fetched_at" --arg sourceUrl "$(BOND_API_URL)" '{ \
		fetchedAt: $$fetchedAt, \
		sourceUrl: $$sourceUrl, \
		auctionId: $$auctionId, \
		health: ., \
		auction: $$auction, \
		bondManager: .bondManager, \
		bondAuction: .bondAuction, \
		sealingPublicKey: .sealingPublicKey, \
		auctionPubKey: $$auction.metadata.auctionPubKey, \
		isin: $$auction.isin, \
		status: $$auction.status \
	}' > "$(BID_BASIC_CONTEXT_FILE)"; \
	echo "Cached basic bid context in $(BID_BASIC_CONTEXT_FILE)"; \
	tmp_input=$$(mktemp /tmp/bid-encrypt-basic.XXXXXX.json); \
	trap 'rm -f "$$tmp_input"' EXIT; \
	mkdir -p "$(dir $(BID_ENCRYPT_BASIC_OUTPUT))"; \
	jq --arg key "$$auction_pub_key" 'if type == "array" then map(.auctioneerPublicKey = $$key) else .auctioneerPublicKey = $$key end' \
		"$(abspath $(BID_ENCRYPT_BASIC_INPUT))" > "$$tmp_input"; \
	npm --prefix scripts/bid-encryption run encrypt -- "$$tmp_input" "$(abspath $(BID_ENCRYPT_BASIC_OUTPUT))" \
		--chainId "$(BID_CHAIN_ID)" --verifyingContract "$$bond_auction" --auctionId "$(AUCTION_ID)"

bid-submit: sandbox-local-fixtures require-bid-vars
	@npm --prefix scripts/bid-submitter run submit -- \
		--sealed-bids "$(abspath $(BID_ENCRYPT_OUTPUT))" --keys "$(abspath $(BID_KEYS))" --bond-auction "$(BOND_AUCTION)" \
		--auction-id "$(AUCTION_ID)" --rpc-url "$(BESU_RPC_URL)"

bid-submit-basic: sandbox-local-fixtures require-basic-bid-vars
	@set -eu; \
	bond_auction="$(BOND_AUCTION)"; \
	bond_manager=""; \
	auction_isin=""; \
	auction_status=""; \
	if [ -z "$$bond_auction" ] && [ -f "$(BID_BASIC_CONTEXT_FILE)" ]; then \
		bond_auction=$$(jq -r '.bondAuction // empty' "$(BID_BASIC_CONTEXT_FILE)"); \
		bond_manager=$$(jq -r '.bondManager // empty' "$(BID_BASIC_CONTEXT_FILE)"); \
		auction_isin=$$(jq -r '.isin // empty' "$(BID_BASIC_CONTEXT_FILE)"); \
		auction_status=$$(jq -r '.status // empty' "$(BID_BASIC_CONTEXT_FILE)"); \
		if [ -n "$$bond_auction" ]; then \
			echo "Using cached basic bid context from $(BID_BASIC_CONTEXT_FILE)"; \
		fi; \
	fi; \
	if [ -z "$$bond_auction" ]; then \
		health_json=$$(curl -fsS "$(BOND_API_URL)/v1/health"); \
		auction_json=$$(curl -fsS "$(BOND_API_URL)/v1/auctions/$(AUCTION_ID)"); \
		bond_manager=$$(printf '%s' "$$health_json" | jq -r '.bondManager'); \
		bond_auction=$$(printf '%s' "$$health_json" | jq -r '.bondAuction'); \
		auction_isin=$$(printf '%s' "$$auction_json" | jq -r '.isin'); \
		auction_status=$$(printf '%s' "$$auction_json" | jq -r '.status'); \
		if [ "$$bond_manager" = "null" ] || [ -z "$$bond_manager" ] || [ "$$bond_auction" = "null" ] || [ -z "$$bond_auction" ]; then \
			echo "Failed to resolve bid context from $(BOND_API_URL)."; \
			exit 1; \
		fi; \
		mkdir -p "$(BID_BASIC_CONTEXT_DIR)"; \
		fetched_at=$$(date +%s); \
		printf '%s' "$$health_json" | jq --argjson auction "$$auction_json" --arg auctionId "$(AUCTION_ID)" --arg fetchedAt "$$fetched_at" --arg sourceUrl "$(BOND_API_URL)" '{ \
			fetchedAt: $$fetchedAt, \
			sourceUrl: $$sourceUrl, \
			auctionId: $$auctionId, \
			health: ., \
			auction: $$auction, \
			bondManager: .bondManager, \
			bondAuction: .bondAuction, \
			sealingPublicKey: .sealingPublicKey, \
			auctionPubKey: $$auction.metadata.auctionPubKey, \
			isin: $$auction.isin, \
			status: $$auction.status \
		}' > "$(BID_BASIC_CONTEXT_FILE)"; \
		echo "Cached basic bid context in $(BID_BASIC_CONTEXT_FILE)"; \
	fi; \
	if [ "$$bond_auction" = "null" ] || [ -z "$$bond_auction" ]; then \
		echo "Failed to resolve bondAuction for basic submit."; \
		exit 1; \
	fi; \
	echo "Resolved basic bid context: auctionId=$(AUCTION_ID) isin=$$auction_isin status=$$auction_status bondManager=$$bond_manager bondAuction=$$bond_auction"; \
	npm --prefix scripts/bid-submitter run submit -- \
		--sealed-bids "$(abspath $(BID_ENCRYPT_BASIC_OUTPUT))" --keys "$(abspath $(BID_KEYS))" --bond-auction "$$bond_auction" \
		--auction-id "$(AUCTION_ID)" --rpc-url "$(BESU_RPC_URL)"

bid-place: bid-encrypt bid-submit

bid-place-basic: bid-encrypt-basic bid-submit-basic
