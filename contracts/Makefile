ENV_FILE := $(shell git rev-parse --show-toplevel)/.env
-include $(ENV_FILE)

MAINNET_RPC_URL := $(or $(RISE_MAINNET_RPC_URL),https://rpc.risechain.com)
TESTNET_RPC_URL := $(or $(RISE_TESTNET_RPC_URL),https://testnet.riselabs.xyz)
BLOCKSCOUT_VERIFIER_URL := https://explorer.risechain.com/api?
TESTNET_BLOCKSCOUT_VERIFIER_URL := https://explorer.testnet.riselabs.xyz/api?
DOT_ADDRESS := 0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3

export QUOTE_TOKEN ICARUS_FACTORY BLOCKSCOUT_API RISE_MAINNET_RPC_URL RISE_RPC_URL

.PHONY: test abis require-fork-tests test-fork-strict test-fork-testnet verify-icarus \
  require-mainnet-rpc require-production-config preflight-mainnet-dot deploy-mainnet-dot \
  deploy-swap-mainnet-dot oracle-status-mainnet require-testnet-config testnet-preflight deploy-testnet-oracle \
  deploy-swap-testnet-oracle build-icarus-swap-adapter

test:
	forge test --threads 1 --no-match-path 'test/fork/*'
	forge build --sizes

require-fork-tests:
	@ls test/fork/*.t.sol >/dev/null 2>&1 || { echo "No fork tests found in test/fork/."; exit 2; }

test-fork-strict: require-fork-tests
	CI_FORK=1 RISE_MAINNET_RPC_URL="$(MAINNET_RPC_URL)" forge test --match-path 'test/fork/*' --match-contract MainnetFork

test-fork-testnet: require-fork-tests
	@test -n "$(TESTNET_RPC_URL)" || { echo "RISE_TESTNET_RPC_URL or VITE_RPC_URL is required."; exit 2; }
	CI_FORK=1 RISE_TESTNET_RPC_URL="$(TESTNET_RPC_URL)" forge test --match-path 'test/fork/*' --match-contract TestnetFork

verify-icarus:
	RISE_MAINNET_RPC_URL="$(MAINNET_RPC_URL)" bash scripts/verify-icarus.sh

abis:
	forge build
	bun scripts/export-abis.ts

require-mainnet-rpc:
	@test "$$(cast chain-id --rpc-url "$(MAINNET_RPC_URL)")" = "4153" || { echo "Mainnet RPC is not chain 4153."; exit 2; }

oracle-status-mainnet: require-mainnet-rpc
	RISE_MAINNET_RPC_URL="$(MAINNET_RPC_URL)" bun scripts/check-mainnet-oracle.ts

require-production-config: require-mainnet-rpc
	@test -z "$$(git status --porcelain -- .)" || { echo "Commit the contracts tree before mainnet preflight."; exit 2; }

# Dry run with the exact sender whose nonce predicts the launchpad address.
preflight-mainnet-dot: require-production-config test test-fork-strict verify-icarus
	forge clean
	forge script scripts/Deploy.s.sol:Deploy --rpc-url "$(MAINNET_RPC_URL)" --sender "$(DOT_ADDRESS)"

# These commands broadcast only the launchpad singletons and the separate swap adapter.
# No live market or smoke token is ever created by a mainnet target.
deploy-mainnet-dot: preflight-mainnet-dot
	@test ! -f ../deployments/4153/curveball-oracle-v3.json || { echo "Oracle mainnet release is already recorded."; exit 2; }
	forge script scripts/Deploy.s.sol:Deploy \
		--rpc-url "$(MAINNET_RPC_URL)" --broadcast --slow --account dot \
		--verify --verifier blockscout --verifier-url "$(BLOCKSCOUT_VERIFIER_URL)" \
		--retries 10 --delay 10

build-icarus-swap-adapter:
	forge build --contracts contracts/CurveIcarusSwapAdapter.sol

deploy-swap-mainnet-dot: require-production-config build-icarus-swap-adapter
	@test -f ../deployments/4153/curveball-oracle-v3.json || { echo "Record the oracle launchpad first."; exit 2; }
	@test ! -f ../deployments/4153/icarus-swap-adapter-oracle-v3.json || { echo "Oracle swap adapter is already recorded."; exit 2; }
	forge test --match-path 'test/unit/IcarusSwapAdapter.t.sol' --match-contract IcarusSwapAdapterTest
	CI_FORK=1 RISE_MAINNET_RPC_URL="$(MAINNET_RPC_URL)" forge test \
		--match-path 'test/fork/Lifecycle.fork.t.sol' \
		--match-contract LifecycleMainnetForkTest \
		--match-test test_fork_adapterTradesBothDirectionsOnTheRealIcarusPool
	forge script scripts/DeployIcarusSwap.s.sol:DeployIcarusSwap --rpc-url "$(MAINNET_RPC_URL)" --sender "$(DOT_ADDRESS)"
	forge script scripts/DeployIcarusSwap.s.sol:DeployIcarusSwap \
		--rpc-url "$(MAINNET_RPC_URL)" --broadcast --slow --account dot \
		--verify --verifier blockscout --verifier-url "$(BLOCKSCOUT_VERIFIER_URL)" \
		--retries 10 --delay 10

require-testnet-config:
	@test -n "$(TESTNET_RPC_URL)" || { echo "RISE_TESTNET_RPC_URL or VITE_RPC_URL is required."; exit 2; }
	@test "$$(cast chain-id --rpc-url "$(TESTNET_RPC_URL)")" = "11155931" || { echo "Testnet RPC is not chain 11155931."; exit 2; }

testnet-preflight: require-testnet-config test test-fork-testnet verify-icarus
	forge script scripts/Deploy.s.sol:Deploy --rpc-url "$(TESTNET_RPC_URL)" --sender "$(DOT_ADDRESS)"

deploy-testnet-oracle: testnet-preflight
	@test ! -f ../deployments/11155931/curveball-oracle-v3.json || { echo "Oracle testnet release is already recorded."; exit 2; }
	forge script scripts/Deploy.s.sol:Deploy \
		--rpc-url "$(TESTNET_RPC_URL)" --broadcast --slow --account dot \
		--verify --verifier blockscout --verifier-url "$(TESTNET_BLOCKSCOUT_VERIFIER_URL)" \
		--retries 10 --delay 10

deploy-swap-testnet-oracle: require-testnet-config build-icarus-swap-adapter
	@test -f ../deployments/11155931/curveball-oracle-v3.json || { echo "Record the oracle launchpad first."; exit 2; }
	forge script scripts/DeployIcarusSwap.s.sol:DeployIcarusSwap --rpc-url "$(TESTNET_RPC_URL)" --sender "$(DOT_ADDRESS)"
	forge script scripts/DeployIcarusSwap.s.sol:DeployIcarusSwap \
		--rpc-url "$(TESTNET_RPC_URL)" --broadcast --slow --account dot \
		--verify --verifier blockscout --verifier-url "$(TESTNET_BLOCKSCOUT_VERIFIER_URL)" \
		--retries 10 --delay 10
