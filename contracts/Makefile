ENV_FILE := $(shell dirname "$$(git rev-parse --path-format=absolute --git-common-dir)")/.env
-include $(ENV_FILE)

ACCOUNT ?= dot
TESTNET_RPC_URL ?= $(if $(RISE_TESTNET_RPC_URL),$(RISE_TESTNET_RPC_URL),https://testnet.riselabs.xyz)

export QUOTE_TOKEN ICARUS_FACTORY BLOCKSCOUT_API RISE_TESTNET_RPC_URL RISE_RPC_URL

.PHONY: test test-fork-strict verify-icarus verify-icarus-testnet deploy-v1-mock-testnet deploy-v2-launch-fee-testnet deploy-holder-reserve-testnet deploy-v21-fee-controller-testnet set-fee-testnet deploy-fee-controller-testnet accept-fee-controller-testnet

# Fresh V1: dot signs, mock venue receives graduation, 0.005 WETH target.
deploy-v1-mock-testnet:
	@DEPLOYER_ADDRESS=0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3 \
	forge script scripts/DeployV1Mock.s.sol:DeployV1Mock \
		--rpc-url "$(TESTNET_RPC_URL)" --broadcast --slow \
		--account "$(ACCOUNT)" --sender 0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3

test:
	forge test --threads 1
	bun scripts/check-bytecode.ts
	bun ../scripts/check-fee-controller-codehash.ts

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

# Fee-enabled replacement V2. The script checks the chain, runs tests, asks for
# the deployment phrase, broadcasts with the local keystore, and saves a log.
deploy-v2-launch-fee-testnet:
	@ACCOUNT="$(ACCOUNT)" TESTNET_RPC_URL="$(TESTNET_RPC_URL)" bash scripts/deploy-v2-launch-fee-testnet.sh

deploy-holder-reserve-testnet:
	@ACCOUNT="$(ACCOUNT)" TESTNET_RPC_URL="$(TESTNET_RPC_URL)" bash scripts/deploy-holder-reserve-testnet.sh

deploy-v21-fee-controller-testnet:
	@ACCOUNT="$(ACCOUNT)" TESTNET_RPC_URL="$(TESTNET_RPC_URL)" bash scripts/deploy-v21-fee-controller-testnet.sh

set-fee-testnet:
	@ACCOUNT="$(ACCOUNT)" TESTNET_RPC_URL="$(TESTNET_RPC_URL)" bash scripts/set-fee-testnet.sh

deploy-fee-controller-testnet:
	@ACCOUNT="$(ACCOUNT)" TESTNET_RPC_URL="$(TESTNET_RPC_URL)" bash scripts/deploy-fee-controller-testnet.sh

accept-fee-controller-testnet:
	@ACCOUNT="$(ACCOUNT)" TESTNET_RPC_URL="$(TESTNET_RPC_URL)" CONTROLLER="$(CONTROLLER)" bash scripts/accept-fee-controller-testnet.sh
