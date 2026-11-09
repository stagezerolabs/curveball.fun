ENV_FILE := $(shell git rev-parse --show-toplevel)/.env
-include $(ENV_FILE)

MAINNET_ACCOUNT ?=
MAINNET_RPC_URL := $(RISE_MAINNET_RPC_URL)
TESTNET_RPC_URL := $(or $(RISE_TESTNET_RPC_URL),$(VITE_RPC_URL))
BLOCKSCOUT_VERIFIER_URL := https://explorer.risechain.com/api?
TESTNET_BLOCKSCOUT_VERIFIER_URL := https://explorer.testnet.riselabs.xyz/api?
DOT_ADDRESS := 0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3

export QUOTE_TOKEN ICARUS_FACTORY BLOCKSCOUT_API RISE_MAINNET_RPC_URL RISE_RPC_URL

.PHONY: test abis smoke-testnet set-testnet-graduation-target deploy-icarus-swap-testnet deploy-icarus-swap-mainnet build-icarus-swap-adapter require-fork-tests test-fork-strict test-fork-testnet verify-icarus require-mainnet-rpc require-mainnet-account require-production-config production-preflight deploy-production require-testnet-config testnet-preflight deploy-testnet

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

# Regenerates src/sdk/abis.generated.ts from the compiled singletons.
abis:
	forge build
	bun scripts/export-abis.ts

require-mainnet-rpc:
	@test -n "$(MAINNET_RPC_URL)" || { echo "RISE_MAINNET_RPC_URL is required."; exit 2; }
	@test "$$(cast chain-id --rpc-url "$(MAINNET_RPC_URL)")" = "4153" || { echo "Mainnet RPC is not chain 4153."; exit 2; }

require-mainnet-account:
	@test -n "$(MAINNET_ACCOUNT)" || { echo "MAINNET_ACCOUNT must name a dedicated mainnet Foundry keystore."; exit 2; }
	@test "$(MAINNET_ACCOUNT)" = "curveball" || { echo "MAINNET_ACCOUNT must be the pinned curveball keystore."; exit 2; }
	@test "$(MAINNET_ACCOUNT)" != "$(TESTNET_ACCOUNT)" || { echo "Mainnet and testnet keystore aliases must differ."; exit 2; }

require-production-config: require-mainnet-rpc require-mainnet-account
	@test -z "$$(git status --porcelain -- .)" || { echo "Commit the contracts tree before mainnet preflight."; exit 2; }

# Dry-runs the pinned mainnet deployment, including its new timelock, without broadcasting.
production-preflight: require-production-config test test-fork-strict verify-icarus
	forge clean
	forge script scripts/Deploy.s.sol:Deploy --rpc-url "$(MAINNET_RPC_URL)" --account "$(MAINNET_ACCOUNT)"

deploy-production: production-preflight
	@test ! -f ../deployments/4153/curveball.json || { echo "Mainnet Curveball is already recorded."; exit 2; }
	@test "$(CONFIRM_DEPLOY)" = "DEPLOY_CURVEBALL_RISE_MAINNET_4153" || { echo "CONFIRM_DEPLOY is required."; exit 2; }
	forge script scripts/Deploy.s.sol:Deploy \
		--rpc-url "$(MAINNET_RPC_URL)" --broadcast --slow --account "$(MAINNET_ACCOUNT)" \
		--verify --verifier blockscout --verifier-url "$(BLOCKSCOUT_VERIFIER_URL)" \
		--retries 10 --delay 10

# Testnet broadcasts from the operator's Foundry keystore. Foundry prompts for its password.
TESTNET_ACCOUNT ?= dot

require-testnet-config:
	@test -n "$(TESTNET_RPC_URL)" || { echo "RISE_TESTNET_RPC_URL or VITE_RPC_URL is required."; exit 2; }
	@test "$$(cast chain-id --rpc-url "$(TESTNET_RPC_URL)")" = "11155931" || { echo "Testnet RPC is not chain 11155931."; exit 2; }

testnet-preflight: require-testnet-config test test-fork-testnet
	forge clean
	forge script scripts/Deploy.s.sol:Deploy --rpc-url "$(TESTNET_RPC_URL)" \
		--account "$(TESTNET_ACCOUNT)"

deploy-testnet: testnet-preflight
	forge script scripts/Deploy.s.sol:Deploy \
		--rpc-url "$(TESTNET_RPC_URL)" --broadcast --slow \
		--account "$(TESTNET_ACCOUNT)" \
		--verify --verifier blockscout --verifier-url "$(TESTNET_BLOCKSCOUT_VERIFIER_URL)" \
		--retries 10 --delay 10

# Deploys the permissionless atomic swap adapter for the recorded testnet launchpad.
# Uses the operator's Foundry keystore and prompts for its password; no key enters the repo.
build-icarus-swap-adapter:
	forge build --contracts contracts/CurveIcarusSwapAdapter.sol

deploy-icarus-swap-testnet: require-testnet-config
	@test ! -f ../deployments/11155931/icarus-swap-adapter.json || { echo "Swap adapter is already recorded."; exit 2; }
	forge test --match-contract IcarusSwapAdapterTest
	CI_FORK=1 RISE_TESTNET_RPC_URL="$(TESTNET_RPC_URL)" forge test \
		--match-path 'test/fork/Lifecycle.fork.t.sol' \
		--match-test test_fork_adapterTradesBothDirectionsOnTheRealIcarusPool
	forge script scripts/DeployIcarusSwap.s.sol:DeployIcarusSwap --rpc-url "$(TESTNET_RPC_URL)"
	forge script scripts/DeployIcarusSwap.s.sol:DeployIcarusSwap \
		--rpc-url "$(TESTNET_RPC_URL)" --broadcast --slow --account "$(TESTNET_ACCOUNT)" \
		--verify --verifier blockscout --verifier-url "$(TESTNET_BLOCKSCOUT_VERIFIER_URL)" \
		--retries 10 --delay 10

# Deploys the atomic swap adapter only after the verified mainnet launchpad is recorded.
# The real-pool adapter fork test must match and pass before any broadcast.
deploy-icarus-swap-mainnet: require-mainnet-rpc require-mainnet-account build-icarus-swap-adapter
	@test -f ../deployments/4153/curveball.json || { echo "Record the mainnet launchpad first."; exit 2; }
	@jq -e '.chainId == 4153 and (.launchpad | type) == "string" and (.launchpad | test("^0x[0-9a-fA-F]{40}$$"))' ../deployments/4153/curveball.json >/dev/null || { echo "Invalid mainnet launchpad record."; exit 2; }
	@test ! -f ../deployments/4153/icarus-swap-adapter.json || { echo "Mainnet swap adapter is already recorded."; exit 2; }
	forge test --match-path 'test/unit/IcarusSwapAdapter.t.sol' --match-contract IcarusSwapAdapterTest
	@set -eu; \
		output="$$(CI_FORK=1 RISE_MAINNET_RPC_URL="$(MAINNET_RPC_URL)" forge test \
			--match-path 'test/fork/Lifecycle.fork.t.sol' \
			--match-contract LifecycleMainnetForkTest \
			--match-test test_fork_adapterTradesBothDirectionsOnTheRealIcarusPool)"; \
		printf '%s\n' "$$output"; \
		printf '%s\n' "$$output" | grep -Eq '1 tests? passed' || { echo "Mainnet adapter fork test did not run."; exit 2; }
	forge script scripts/DeployIcarusSwap.s.sol:DeployIcarusSwap --rpc-url "$(MAINNET_RPC_URL)"
	@test "$(CONFIRM_ICARUS_SWAP_DEPLOY)" = "DEPLOY_ICARUS_SWAP_RISE_MAINNET_4153" || { echo "CONFIRM_ICARUS_SWAP_DEPLOY is required."; exit 2; }
	forge script scripts/DeployIcarusSwap.s.sol:DeployIcarusSwap \
		--rpc-url "$(MAINNET_RPC_URL)" --broadcast --slow --account "$(MAINNET_ACCOUNT)" \
		--verify --verifier blockscout --verifier-url "$(BLOCKSCOUT_VERIFIER_URL)" \
		--retries 10 --delay 10

# Updates the recorded live testnet launchpad. This prompts for the dot keystore password.
set-testnet-graduation-target: require-testnet-config
	@set -eu; \
		record="../deployments/11155931/curveball.json"; \
		launchpad="$$(jq -er '.launchpad | select(type == "string" and test("^0x[0-9a-fA-F]{40}$$"))' "$$record")"; \
		owner="$$(cast call "$$launchpad" 'owner()(address)' --rpc-url "$(TESTNET_RPC_URL)")"; \
		test "$$(printf '%s' "$$owner" | tr '[:upper:]' '[:lower:]')" = "$$(printf '%s' "$(DOT_ADDRESS)" | tr '[:upper:]' '[:lower:]')" || { echo "Recorded launchpad is not owned by dot."; exit 2; }; \
		target=4000000000000000000; \
		current_hex="$$(cast call "$$launchpad" 'graduationTarget()' --rpc-url "$(TESTNET_RPC_URL)")"; \
		current="$$(cast to-dec "$$current_hex")"; \
		if test "$$current" != "$$target"; then \
			cast send "$$launchpad" 'setGraduationTarget(uint256)' "$$target" --rpc-url "$(TESTNET_RPC_URL)" --account dot --confirmations 1; \
		fi; \
		actual_hex="$$(cast call "$$launchpad" 'graduationTarget()' --rpc-url "$(TESTNET_RPC_URL)")"; \
		actual="$$(cast to-dec "$$actual_hex")"; \
		test "$$actual" = "$$target" || { echo "Testnet graduation target verification failed: $$actual"; exit 2; }; \
		echo "Verified testnet graduation target: 4 WETH ($$actual wei)."

# Broadcasts only a smoke-token launch and first buy; graduation is simulated in fork tests.
# Fund the broadcaster for the live launch fee, 0.003 ETH first-buy budget, and gas.
smoke-testnet: require-testnet-config
	forge script scripts/Smoke.s.sol:Smoke --rpc-url "$(TESTNET_RPC_URL)" --broadcast --slow \
		--account "$(TESTNET_ACCOUNT)"
