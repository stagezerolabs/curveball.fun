ENV_FILE := $(shell dirname "$$(git rev-parse --path-format=absolute --git-common-dir)")/.env
-include $(ENV_FILE)

ACCOUNT ?= dot
MAINNET_RPC_URL ?= $(RISE_RPC_URL)

export RPC_URL EXPECTED_CHAIN_ID QUOTE_TOKEN ICARUS_FACTORY TREASURY CONFIRM_MAINNET CONFIRM_TOKEN BLOCKSCOUT_API LAUNCHPAD_ADDRESS

.PHONY: test verify-icarus deploy-devnet simulate-mainnet deploy-mainnet create-nominatebear

test:
	forge test

verify-icarus:
	bash scripts/verify-icarus.sh

deploy-devnet:
	@test -t 0 || { echo "Run this target in an interactive terminal."; exit 1; }
	@test -n "$$RPC_URL" && test -n "$$EXPECTED_CHAIN_ID" && test -n "$$QUOTE_TOKEN" && test -n "$$ICARUS_FACTORY" && test -n "$$TREASURY" || { echo "Set RPC_URL, EXPECTED_CHAIN_ID, QUOTE_TOKEN, ICARUS_FACTORY and TREASURY."; exit 1; }
	@chain_id=$$(cast chain-id --rpc-url "$$RPC_URL") || exit; test "$$chain_id" = "$$EXPECTED_CHAIN_ID" && test "$$chain_id" != 4153 || { echo "Wrong chain or RISE mainnet (4153); refusing deployment."; exit 1; }
	@forge script scripts/Deploy.s.sol:Deploy --rpc-url "$$RPC_URL" --broadcast --account "$(ACCOUNT)"

simulate-mainnet:
	@test -n "$(MAINNET_RPC_URL)" && test -n "$$TREASURY" || { echo "Set RISE_RPC_URL and TREASURY."; exit 1; }
	@test "$$TREASURY" = "0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3" || { echo "TREASURY must be dot: 0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3"; exit 1; }
	@test "$$(cast chain-id --rpc-url "$(MAINNET_RPC_URL)")" = "4153" || { echo "RPC is not RISE mainnet."; exit 1; }
	@CONFIRM_MAINNET=DEPLOY_CURVEBALL_RISE_4153 forge script scripts/DeployMainnet.s.sol:DeployMainnet --rpc-url "$(MAINNET_RPC_URL)"

deploy-mainnet:
	@test -t 0 || { echo "Run this target in an interactive terminal."; exit 1; }
	@test -z "$$LAUNCHPAD_ADDRESS" || { echo "LAUNCHPAD_ADDRESS is already configured; refusing an accidental redeployment."; exit 1; }
	@test -n "$(MAINNET_RPC_URL)" && test -n "$$TREASURY" && test -n "$(BLOCKSCOUT_API)" || { echo "Set RISE_RPC_URL, TREASURY and BLOCKSCOUT_API."; exit 1; }
	@test "$$TREASURY" = "0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3" || { echo "TREASURY must be dot: 0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3"; exit 1; }
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
