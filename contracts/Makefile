ENV_FILE := $(shell dirname "$$(git rev-parse --path-format=absolute --git-common-dir)")/.env
-include $(ENV_FILE)

ACCOUNT ?= dot
MAINNET_RPC_URL ?= $(RISE_RPC_URL)
TESTNET_RPC_URL ?= $(RISE_TESTNET_RPC_URL)

export RPC_URL EXPECTED_CHAIN_ID QUOTE_TOKEN ICARUS_FACTORY TREASURY MULTISIG CONFIRM_MAINNET CONFIRM_TESTNET CONFIRM_TOKEN BLOCKSCOUT_API LAUNCHPAD_ADDRESS RISE_TESTNET_RPC_URL RISE_RPC_URL

.PHONY: test test-fork-strict verify-icarus verify-icarus-testnet deploy-devnet simulate-testnet deploy-testnet record-testnet simulate-mainnet deploy-mainnet create-nominatebear

test:
	forge test --threads 1

test-fork-strict:
	@test -n "$(RISE_TESTNET_RPC_URL)" || { echo "RISE_TESTNET_RPC_URL is required for strict fork tests."; exit 2; }
	forge test --match-path 'test/fork/IcarusFactory.t.sol'

test-mainnet-fork-strict:
	@test -n "$(RISE_RPC_URL)" || { echo "RISE_RPC_URL is required for mainnet fork tests."; exit 2; }
	forge test --match-path 'test/fork/MainnetLifecycle.t.sol'

verify-icarus:
	bash scripts/verify-icarus.sh

verify-icarus-testnet:
	ICARUS_FACTORY=0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9 \
		QUOTE_TOKEN=0x4200000000000000000000000000000000000006 \
		BLOCKSCOUT_API=https://explorer.testnet.riselabs.xyz/api \
		VERIFY_OUTPUT=../deployments/11155931/icarus-verification.json \
		bash scripts/verify-icarus-testnet.sh

deploy-devnet:
	@test -t 0 || { echo "Run this target in an interactive terminal."; exit 1; }
	@test -n "$$RPC_URL" && test -n "$$EXPECTED_CHAIN_ID" && test -n "$$QUOTE_TOKEN" && test -n "$$ICARUS_FACTORY" && test -n "$$TREASURY" || { echo "Set RPC_URL, EXPECTED_CHAIN_ID, QUOTE_TOKEN, ICARUS_FACTORY and TREASURY."; exit 1; }
	@chain_id=$$(cast chain-id --rpc-url "$$RPC_URL") || exit; test "$$chain_id" = "$$EXPECTED_CHAIN_ID" && test "$$chain_id" != 4153 || { echo "Wrong chain or RISE mainnet (4153); refusing deployment."; exit 1; }
	@forge script scripts/Deploy.s.sol:Deploy --rpc-url "$$RPC_URL" --broadcast --account "$(ACCOUNT)"

simulate-testnet:
	@test -n "$(TESTNET_RPC_URL)" && test -n "$$TREASURY" || { echo "Set RISE_TESTNET_RPC_URL and TREASURY."; exit 1; }
	@test "$$TREASURY" = "0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3" || { echo "TREASURY must be dot: 0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3"; exit 1; }
	@test "$$(cast chain-id --rpc-url "$(TESTNET_RPC_URL)")" = "11155931" || { echo "RPC is not RISE Testnet."; exit 1; }
	@CONFIRM_TESTNET=DEPLOY_CURVEBALL_RISE_TESTNET_11155931 forge script scripts/DeployTestnet.s.sol:DeployTestnet --rpc-url "$(TESTNET_RPC_URL)"

deploy-testnet:
	@test -t 0 || { echo "Run this target in an interactive terminal."; exit 1; }
	@test ! -f broadcast/DeployTestnet.s.sol/11155931/run-latest.json || { echo "A RISE Testnet broadcast receipt already exists; refusing an accidental redeployment."; exit 1; }
	@test -n "$(TESTNET_RPC_URL)" && test -n "$$TREASURY" && test -n "$(BLOCKSCOUT_API)" || { echo "Set RISE_TESTNET_RPC_URL, TREASURY and BLOCKSCOUT_API."; exit 1; }
	@test "$$TREASURY" = "0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3" || { echo "TREASURY must be dot: 0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3"; exit 1; }
	@test "$$CONFIRM_TESTNET" = "DEPLOY_CURVEBALL_RISE_TESTNET_11155931" || { echo "Set CONFIRM_TESTNET=DEPLOY_CURVEBALL_RISE_TESTNET_11155931."; exit 1; }
	@test "$$(cast chain-id --rpc-url "$(TESTNET_RPC_URL)")" = "11155931" || { echo "RPC is not RISE Testnet."; exit 1; }
	@forge script scripts/DeployTestnet.s.sol:DeployTestnet --rpc-url "$(TESTNET_RPC_URL)" --broadcast --account dot --verify --verifier blockscout --verifier-url "$(BLOCKSCOUT_API)"

record-testnet:
	RISE_TESTNET_RPC_URL="$(TESTNET_RPC_URL)" \
		BLOCKSCOUT_API=https://explorer.testnet.riselabs.xyz/api \
		bash scripts/record-testnet-deployment.sh

simulate-mainnet:
	@test -n "$(MAINNET_RPC_URL)" && test -n "$$MULTISIG" || { echo "Set RISE_RPC_URL and MULTISIG."; exit 1; }
	@test "$$(cast chain-id --rpc-url "$(MAINNET_RPC_URL)")" = "4153" || { echo "RPC is not RISE mainnet."; exit 1; }
	@CONFIRM_MAINNET=DEPLOY_CURVEBALL_RISE_4153 forge script scripts/DeployMainnet.s.sol:DeployMainnet --rpc-url "$(MAINNET_RPC_URL)"

deploy-mainnet:
	@test -t 0 || { echo "Run this target in an interactive terminal."; exit 1; }
	@test -z "$$LAUNCHPAD_ADDRESS" || { echo "LAUNCHPAD_ADDRESS is already configured; refusing an accidental redeployment."; exit 1; }
	@test -n "$(MAINNET_RPC_URL)" && test -n "$$MULTISIG" && test -n "$(BLOCKSCOUT_API)" || { echo "Set RISE_RPC_URL, MULTISIG and BLOCKSCOUT_API."; exit 1; }
	@test "$$CONFIRM_MAINNET" = "DEPLOY_CURVEBALL_RISE_4153" || { echo "Set CONFIRM_MAINNET=DEPLOY_CURVEBALL_RISE_4153."; exit 1; }
	@test "$$(cast chain-id --rpc-url "$(MAINNET_RPC_URL)")" = "4153" || { echo "RPC is not RISE mainnet."; exit 1; }
	@forge script scripts/DeployMainnet.s.sol:DeployMainnet --rpc-url "$(MAINNET_RPC_URL)" --broadcast --account dot --verify --verifier blockscout --verifier-url "$(BLOCKSCOUT_API)"

create-nominatebear:
	@test -t 0 || { echo "Run this target in an interactive terminal."; exit 1; }
	@test -n "$(MAINNET_RPC_URL)" && test -n "$$LAUNCHPAD_ADDRESS" || { echo "Set RISE_RPC_URL and LAUNCHPAD_ADDRESS."; exit 1; }
	@test "$$LAUNCHPAD_ADDRESS" = "0x1A34768eAb2F6b925D25ca1d6daC03C1a25Ad39E" || { echo "LAUNCHPAD_ADDRESS is not the canonical RISE deployment."; exit 1; }
	@test "$$CONFIRM_TOKEN" = "CREATE_NOMINATEBEAR_NBR" || { echo "Set CONFIRM_TOKEN=CREATE_NOMINATEBEAR_NBR."; exit 1; }
	@test "$$(cast chain-id --rpc-url "$(MAINNET_RPC_URL)")" = "4153" || { echo "RPC is not RISE mainnet."; exit 1; }
	@forge script scripts/CreateNominateBear.s.sol:CreateNominateBear --rpc-url "$(MAINNET_RPC_URL)" --broadcast --account dot
