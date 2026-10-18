ENV_FILE := $(shell dirname "$$(git rev-parse --path-format=absolute --git-common-dir)")/.env
-include $(ENV_FILE)

ACCOUNT ?= dot
MAINNET_RPC_URL := $(RISE_MAINNET_RPC_URL)
TESTNET_RPC_URL := $(or $(RISE_TESTNET_RPC_URL),$(VITE_RPC_URL))
BLOCKSCOUT_VERIFIER_URL := https://explorer.risechain.com/api?
TESTNET_BLOCKSCOUT_VERIFIER_URL := https://explorer.testnet.riselabs.xyz/api?
DOT_ADDRESS := 0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3

export QUOTE_TOKEN ICARUS_FACTORY BLOCKSCOUT_API RISE_MAINNET_RPC_URL RISE_RPC_URL

.PHONY: test require-fork-tests test-fork-strict test-fork-testnet verify-icarus production-preflight deploy-production testnet-preflight deploy-testnet

# Fork suites need network access; they run only through the targets below.
test:
	forge test --threads 1 --no-match-path 'test/fork/*'
	forge build --sizes

# Fork suites read CI_FORK=1 and fail instead of skipping when their RPC is missing.
# forge exits 0 when a filter matches nothing, so require the suite to exist first.
require-fork-tests:
	@ls test/fork/*.t.sol >/dev/null 2>&1 || { echo "No fork tests found in test/fork/."; exit 2; }

test-fork-strict: require-fork-tests
	@test -n "$(RISE_MAINNET_RPC_URL)" || { echo "RISE_MAINNET_RPC_URL is required for strict fork tests."; exit 2; }
	CI_FORK=1 forge test --match-path 'test/fork/*' --match-contract MainnetFork

test-fork-testnet: require-fork-tests
	@test -n "$(TESTNET_RPC_URL)" || { echo "RISE_TESTNET_RPC_URL or VITE_RPC_URL is required."; exit 2; }
	CI_FORK=1 RISE_TESTNET_RPC_URL="$(TESTNET_RPC_URL)" forge test --match-path 'test/fork/*' --match-contract TestnetFork

verify-icarus:
	bash scripts/verify-icarus.sh

# The V1 deploy scripts were removed; scripts/Deploy.s.sol replaces them (lean-contracts-v2 Task 24).
production-preflight deploy-production testnet-preflight deploy-testnet:
	@echo "$@ is unavailable until scripts/Deploy.s.sol lands (lean-contracts-v2 Task 24)."; exit 2
