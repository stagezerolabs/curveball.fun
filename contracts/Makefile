ENV_FILE := $(shell dirname "$$(git rev-parse --path-format=absolute --git-common-dir)")/.env
-include $(ENV_FILE)

ACCOUNT ?= dot
MAINNET_RPC_URL := $(RISE_MAINNET_RPC_URL)
BLOCKSCOUT_VERIFIER_URL := https://explorer.risechain.com/api?

export QUOTE_TOKEN ICARUS_FACTORY BLOCKSCOUT_API RISE_MAINNET_RPC_URL RISE_RPC_URL

.PHONY: test test-fork-strict verify-icarus require-production-config production-preflight deploy-production

test:
	forge test --threads 1
	bun scripts/check-bytecode.ts

test-fork-strict:
	@test -n "$(RISE_MAINNET_RPC_URL)" || { echo "RISE_MAINNET_RPC_URL is required for strict fork tests."; exit 2; }
	forge test --match-path 'test/fork/IcarusFactory.t.sol'

verify-icarus:
	bash scripts/verify-icarus.sh

require-production-config:
	@test -n "$(MAINNET_RPC_URL)" || { echo "RISE_MAINNET_RPC_URL is required and must use a private provider."; exit 2; }
	@test -n "$(DEPLOYER_ADDRESS)" -a -n "$(OWNER_ADDRESS)" -a -n "$(TREASURY_ADDRESS)" || { echo "DEPLOYER_ADDRESS, OWNER_ADDRESS, and TREASURY_ADDRESS are required."; exit 2; }
	@test "$(LAUNCH_FEE_WEI)" = "1000000000000000" || { echo "LAUNCH_FEE_WEI must be 1000000000000000 (0.001 WETH)."; exit 2; }
	@test -n "$(GRADUATION_TARGET_WEI)" || { echo "GRADUATION_TARGET_WEI is required."; exit 2; }
	@test "$$(cast chain-id --rpc-url "$(MAINNET_RPC_URL)")" = "4153" || { echo "RISE_MAINNET_RPC_URL is not chain 4153."; exit 2; }

production-preflight: require-production-config test test-fork-strict
	forge script scripts/DeployProduction.s.sol:DeployProduction --rpc-url "$(MAINNET_RPC_URL)" --sender "$(DEPLOYER_ADDRESS)"

deploy-production: production-preflight
	forge script scripts/DeployProduction.s.sol:DeployProduction \
		--rpc-url "$(MAINNET_RPC_URL)" --broadcast --slow \
		--account "$(ACCOUNT)" --sender "$(DEPLOYER_ADDRESS)" \
		--verify --verifier blockscout --verifier-url "$(BLOCKSCOUT_VERIFIER_URL)" \
		--retries 10 --delay 10
