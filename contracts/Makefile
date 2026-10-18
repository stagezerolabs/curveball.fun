ENV_FILE := $(shell dirname "$$(git rev-parse --path-format=absolute --git-common-dir)")/.env
-include $(ENV_FILE)

ACCOUNT ?= dot
MAINNET_RPC_URL := $(RISE_MAINNET_RPC_URL)
TESTNET_RPC_URL := $(or $(RISE_TESTNET_RPC_URL),$(VITE_RPC_URL))
BLOCKSCOUT_VERIFIER_URL := https://explorer.risechain.com/api?
TESTNET_BLOCKSCOUT_VERIFIER_URL := https://explorer.testnet.riselabs.xyz/api?
DOT_ADDRESS := 0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3

export QUOTE_TOKEN ICARUS_FACTORY BLOCKSCOUT_API RISE_MAINNET_RPC_URL RISE_RPC_URL

.PHONY: test test-fork-strict test-fork-testnet verify-icarus production-preflight deploy-production testnet-preflight deploy-testnet

test:
	forge test --threads 1
	forge build --sizes

test-fork-strict:
	@test -n "$(RISE_MAINNET_RPC_URL)" || { echo "RISE_MAINNET_RPC_URL is required for strict fork tests."; exit 2; }
	forge test --match-path 'test/fork/*'

test-fork-testnet:
	@test -n "$(TESTNET_RPC_URL)" || { echo "RISE_TESTNET_RPC_URL or VITE_RPC_URL is required."; exit 2; }
	RISE_TESTNET_RPC_URL="$(TESTNET_RPC_URL)" forge test --match-path 'test/fork/*'

verify-icarus:
	bash scripts/verify-icarus.sh

# The V1 deploy scripts were removed; scripts/Deploy.s.sol replaces them (lean-contracts-v2 Task 24).
production-preflight deploy-production testnet-preflight deploy-testnet:
	@echo "$@ is unavailable until scripts/Deploy.s.sol lands (lean-contracts-v2 Task 24)."; exit 2
