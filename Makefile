ENV_FILE := $(shell dirname "$$(git rev-parse --path-format=absolute --git-common-dir)")/.env
-include $(ENV_FILE)

export RISE_MAINNET_RPC_URL RISE_TESTNET_RPC_URL VITE_RPC_URL

.DEFAULT_GOAL := help

.PHONY: help dev build test typecheck contracts-test testnet-preflight deploy-testnet record-testnet configure-testnet production-preflight deploy-production record-production configure-production

help:
	@echo "make dev                 Run the static frontend"
	@echo "make build               Build the static frontend"
	@echo "make test                Run typecheck and contract tests"
	@echo "make contracts-test      Run Foundry contract tests"
	@echo "make testnet-preflight        Run the real RISE Testnet lifecycle and deployment simulation"
	@echo "make deploy-testnet           Broadcast and source-verify the current testnet deployment"
	@echo "make record-testnet           Validate and record the confirmed testnet deployment"
	@echo "make configure-testnet        Point the local UI at the recorded testnet deployment"
	@echo "make production-preflight     Run contract, fork, dependency, and deployment simulation gates"
	@echo "make deploy-production        Broadcast and source-verify the reviewed RISE mainnet deployment"
	@echo "make record-production        Validate wiring/sources and record the confirmed deployment"
	@echo "make configure-production     Point the production frontend at the recorded deployment"

dev:
	bun run dev

build:
	bun run build

test: typecheck contracts-test

typecheck:
	bun run typecheck

contracts-test:
	$(MAKE) -C contracts test

testnet-preflight:
	$(MAKE) -C contracts testnet-preflight

deploy-testnet:
	$(MAKE) -C contracts deploy-testnet

record-testnet:
	DEPLOYMENT_NETWORK=testnet bun contracts/scripts/record-production.ts

configure-testnet:
	DEPLOYMENT_NETWORK=testnet bun contracts/scripts/sync-production-config.ts

production-preflight:
	$(MAKE) -C contracts production-preflight

deploy-production:
	$(MAKE) -C contracts deploy-production

record-production:
	bun contracts/scripts/record-production.ts

configure-production:
	bun contracts/scripts/sync-production-config.ts
