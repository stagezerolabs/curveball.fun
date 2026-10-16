.DEFAULT_GOAL := help

.PHONY: help dev build test typecheck contracts-test deploy-v1-mock-testnet deploy-v2-testnet deploy-holder-reserve-testnet set-fee-testnet deploy-fee-controller-testnet accept-fee-controller-testnet

help:
	@echo "make dev                 Run the static frontend"
	@echo "make build               Build the static frontend"
	@echo "make test                Run frontend tests and typecheck"
	@echo "make contracts-test      Run Foundry contract tests"
	@echo "make deploy-v1-mock-testnet   Deploy fresh V1 with a mock venue using dot"
	@echo "make deploy-v2-testnet   Open the guarded V2 deployment flow"
	@echo "make deploy-holder-reserve-testnet   Open the guarded holder-reserve deployment flow"
	@echo "make set-fee-testnet     Set the live RISE Testnet V2 fee to 0.75%"
	@echo "make deploy-fee-controller-testnet  Deploy dot-owned fee controller"
	@echo "make accept-fee-controller-testnet CONTROLLER=0x...  Complete controller ownership"

dev:
	bun run dev

build:
	bun run build

test: typecheck contracts-test

typecheck:
	bun run typecheck

contracts-test:
	$(MAKE) -C contracts test

deploy-v1-mock-testnet:
	$(MAKE) -C contracts deploy-v1-mock-testnet

deploy-v2-testnet:
	@$(MAKE) -C contracts deploy-v2-testnet-interactive

deploy-holder-reserve-testnet:
	@$(MAKE) -C contracts deploy-holder-reserve-testnet

set-fee-testnet:
	@$(MAKE) -C contracts set-fee-testnet

deploy-fee-controller-testnet:
	@$(MAKE) -C contracts deploy-fee-controller-testnet

accept-fee-controller-testnet:
	@$(MAKE) -C contracts accept-fee-controller-testnet CONTROLLER="$(CONTROLLER)"
