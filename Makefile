.DEFAULT_GOAL := help

.PHONY: help dev build test typecheck contracts-test deploy-v2-testnet

help:
	@echo "make dev                 Run the static frontend"
	@echo "make build               Build the static frontend"
	@echo "make test                Run frontend tests and typecheck"
	@echo "make contracts-test      Run Foundry contract tests"
	@echo "make deploy-v2-testnet   Open the guarded V2 deployment flow"

dev:
	bun run dev

build:
	bun run build

test: typecheck contracts-test

typecheck:
	bun run typecheck

contracts-test:
	$(MAKE) -C contracts test

deploy-v2-testnet:
	@$(MAKE) -C contracts deploy-v2-testnet-interactive
