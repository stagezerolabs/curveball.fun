ENV_FILE := $(shell dirname "$$(git rev-parse --path-format=absolute --git-common-dir)")/.env
-include $(ENV_FILE)

ACCOUNT ?= dot

export RPC_URL EXPECTED_CHAIN_ID QUOTE_TOKEN ICARUS_FACTORY TREASURY

.PHONY: test verify-icarus deploy-devnet

test:
	forge test

verify-icarus:
	bash scripts/verify-icarus.sh

deploy-devnet:
	@test -t 0 || { echo "Run this target in an interactive terminal."; exit 1; }
	@test -n "$$RPC_URL" && test -n "$$EXPECTED_CHAIN_ID" && test -n "$$QUOTE_TOKEN" && test -n "$$ICARUS_FACTORY" && test -n "$$TREASURY" || { echo "Set RPC_URL, EXPECTED_CHAIN_ID, QUOTE_TOKEN, ICARUS_FACTORY and TREASURY."; exit 1; }
	@chain_id=$$(cast chain-id --rpc-url "$$RPC_URL") || exit; test "$$chain_id" = "$$EXPECTED_CHAIN_ID" && test "$$chain_id" != 4153 || { echo "Wrong chain or RISE mainnet (4153); refusing deployment."; exit 1; }
	@forge script scripts/Deploy.s.sol:Deploy --rpc-url "$$RPC_URL" --broadcast --account "$(ACCOUNT)"
