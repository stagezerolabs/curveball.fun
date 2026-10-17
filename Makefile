.DEFAULT_GOAL := help

.PHONY: help dev build test typecheck contracts-test production-preflight deploy-production record-production configure-production

help:
	@echo "make dev                 Run the static frontend"
	@echo "make build               Build the static frontend"
	@echo "make test                Run typecheck and contract tests"
	@echo "make contracts-test      Run Foundry contract tests"
	@echo "make production-preflight     Run contract, fork, dependency, and deployment simulation gates"
	@echo "make deploy-production        Broadcast the reviewed deployment to RISE mainnet"
	@echo "make record-production        Validate and record the confirmed mainnet deployment"
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

production-preflight:
	$(MAKE) -C contracts production-preflight

deploy-production:
	$(MAKE) -C contracts deploy-production

record-production:
	bun contracts/scripts/record-production.ts

configure-production:
	bun contracts/scripts/sync-production-config.ts
