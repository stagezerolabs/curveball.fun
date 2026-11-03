ENV_FILE := $(shell dirname "$$(git rev-parse --path-format=absolute --git-common-dir)")/.env
-include $(ENV_FILE)

ACCOUNT ?= dot
MAINNET_RPC_URL := $(RISE_MAINNET_RPC_URL)
TESTNET_RPC_URL := $(or $(RISE_TESTNET_RPC_URL),$(VITE_RPC_URL))
BLOCKSCOUT_VERIFIER_URL := https://explorer.risechain.com/api?
TESTNET_BLOCKSCOUT_VERIFIER_URL := https://explorer.testnet.riselabs.xyz/api?
DOT_ADDRESS := 0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3

export QUOTE_TOKEN ICARUS_FACTORY BLOCKSCOUT_API RISE_MAINNET_RPC_URL RISE_RPC_URL

.PHONY: test abis smoke-testnet set-testnet-graduation-target require-fork-tests test-fork-strict test-fork-testnet verify-icarus require-production-config production-preflight deploy-production require-testnet-config testnet-preflight deploy-testnet

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

require-production-config:
	@test -n "$(MAINNET_RPC_URL)" || { echo "RISE_MAINNET_RPC_URL is required."; exit 2; }
	@test "$$(cast chain-id --rpc-url "$(MAINNET_RPC_URL)")" = "4153" || { echo "Mainnet RPC is not chain 4153."; exit 2; }
	@for v in CURVE_OWNER CURVE_GUARDIAN CURVE_TREASURY CURVE_TIMELOCK_PROPOSER CURVE_GRADUATION_TARGET; do \
		test -n "$$(printenv $$v)" || { echo "$$v is required."; exit 2; }; done

# Dry-runs the deployment, including the timelock, guardian and treasury preflight, without broadcasting.
production-preflight: require-production-config test test-fork-strict verify-icarus
	forge clean
	forge script scripts/Deploy.s.sol:Deploy --rpc-url "$(MAINNET_RPC_URL)" --account "$(ACCOUNT)"

deploy-production: production-preflight
	@test "$(CONFIRM_DEPLOY)" = "DEPLOY_CURVEBALL_RISE_MAINNET_4153" || { echo "CONFIRM_DEPLOY is required."; exit 2; }
	forge script scripts/Deploy.s.sol:Deploy \
		--rpc-url "$(MAINNET_RPC_URL)" --broadcast --slow --account "$(ACCOUNT)" \
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

# Updates the recorded live testnet launchpad. This prompts for the dot keystore password.
set-testnet-graduation-target: require-testnet-config
	@set -eu; \
		record="../deployments/11155931/curveball.json"; \
		launchpad="$$(jq -er '.launchpad | select(type == "string" and test("^0x[0-9a-fA-F]{40}$$"))' "$$record")"; \
		owner="$$(cast call "$$launchpad" 'owner()(address)' --rpc-url "$(TESTNET_RPC_URL)")"; \
		test "$$(printf '%s' "$$owner" | tr '[:upper:]' '[:lower:]')" = "$$(printf '%s' "$(DOT_ADDRESS)" | tr '[:upper:]' '[:lower:]')" || { echo "Recorded launchpad is not owned by dot."; exit 2; }; \
		target=4000000000000000000; \
		current="$$(cast call "$$launchpad" 'graduationTarget()(uint256)' --rpc-url "$(TESTNET_RPC_URL)")"; \
		if test "$$current" != "$$target"; then \
			cast send "$$launchpad" 'setGraduationTarget(uint256)' "$$target" --rpc-url "$(TESTNET_RPC_URL)" --account dot --confirmations 1; \
		fi; \
		actual="$$(cast call "$$launchpad" 'graduationTarget()(uint256)' --rpc-url "$(TESTNET_RPC_URL)")"; \
		test "$$actual" = "$$target" || { echo "Testnet graduation target verification failed: $$actual"; exit 2; }; \
		echo "Verified testnet graduation target: 4 WETH ($$actual wei)."

# Runs one market through the recorded testnet deployment end to end; fund for its target.
smoke-testnet: require-testnet-config
	forge script scripts/Smoke.s.sol:Smoke --rpc-url "$(TESTNET_RPC_URL)" --broadcast --slow \
		--account "$(TESTNET_ACCOUNT)"
