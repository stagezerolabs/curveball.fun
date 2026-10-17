ENV_FILE := $(shell dirname "$$(git rev-parse --path-format=absolute --git-common-dir)")/.env
-include $(ENV_FILE)

ACCOUNT ?= dot
TESTNET_RPC_URL ?= $(if $(RISE_TESTNET_RPC_URL),$(RISE_TESTNET_RPC_URL),https://testnet.riselabs.xyz)

export QUOTE_TOKEN ICARUS_FACTORY BLOCKSCOUT_API RISE_TESTNET_RPC_URL RISE_RPC_URL

.PHONY: test test-fork-strict verify-icarus verify-icarus-testnet deploy-v1-mock-testnet

# Fresh V1: dot signs, mock venue receives graduation, 0.005 WETH target.
deploy-v1-mock-testnet:
	@DEPLOYER_ADDRESS=0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3 \
	forge script scripts/DeployV1Mock.s.sol:DeployV1Mock \
		--rpc-url "$(TESTNET_RPC_URL)" --broadcast --slow \
		--account "$(ACCOUNT)" --sender 0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3

test:
	forge test --threads 1
	bun scripts/check-bytecode.ts

test-fork-strict:
	@test -n "$(RISE_TESTNET_RPC_URL)" || { echo "RISE_TESTNET_RPC_URL is required for strict fork tests."; exit 2; }
	forge test --match-path 'test/fork/IcarusFactory.t.sol'

verify-icarus:
	bash scripts/verify-icarus.sh

verify-icarus-testnet:
	ICARUS_FACTORY=0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9 \
		QUOTE_TOKEN=0x4200000000000000000000000000000000000006 \
		BLOCKSCOUT_API=https://explorer.testnet.riselabs.xyz/api \
		VERIFY_OUTPUT=../deployments/11155931/icarus-verification.json \
		bash scripts/verify-icarus-testnet.sh
