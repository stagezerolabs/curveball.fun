.DEFAULT_GOAL := help

.PHONY: help dev build test typecheck contracts-test deploy-v1-mock-testnet

help:
	@echo "make dev                 Run the static frontend"
	@echo "make build               Build the static frontend"
	@echo "make test                Run typecheck and contract tests"
	@echo "make contracts-test      Run Foundry contract tests"
	@echo "make deploy-v1-mock-testnet   Deploy fresh V1 with a mock venue using dot"

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
