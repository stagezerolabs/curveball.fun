ENV_FILE := $(shell git rev-parse --show-toplevel 2>/dev/null || pwd)/.env
-include $(ENV_FILE)

export RISE_MAINNET_RPC_URL RISE_TESTNET_RPC_URL VITE_RPC_URL

COMPOSE ?= docker compose
MAINNET_LOCAL_COMPOSE := docker compose -p curveball-mainnet -f compose.yaml
MAINNET_RPC_URL := $(or $(RISE_MAINNET_RPC_URL),https://rpc.risechain.com)
SERVICES ?=
TAIL ?= 100

.DEFAULT_GOAL := help

.PHONY: help dev build build-testnet test typecheck js-tests contracts-test \
  preflight-mainnet-dot deploy-mainnet-dot record-mainnet-dot deploy-swap-mainnet-dot \
  record-swap-mainnet-dot configure-mainnet-dot configure-mainnet-host oracle-status-mainnet reset-mainnet-database \
  testnet-preflight deploy-testnet-oracle record-testnet-oracle \
  deploy-swap-testnet-oracle record-swap-testnet-oracle configure-testnet-oracle \
  docker-setup docker-up docker-down docker-rebuild docker-status docker-config \
  docker-logs docker-clean-old-images docker-fresh-testnet \
  docker-mainnet-up docker-mainnet-rebuild docker-mainnet-status \
  docker-mainnet-logs docker-mainnet-down

help:
	@echo "Build:    dev, build, build-testnet, test"
	@echo "Mainnet:  preflight-mainnet-dot, deploy-mainnet-dot, record-mainnet-dot"
	@echo "          deploy-swap-mainnet-dot, record-swap-mainnet-dot, configure-mainnet-dot, oracle-status-mainnet"
	@echo "VPS:      configure-mainnet-host, reset-mainnet-database"
	@echo "Testnet:  testnet-preflight, deploy-testnet-oracle, record-testnet-oracle"
	@echo "          deploy-swap-testnet-oracle, record-swap-testnet-oracle, configure-testnet-oracle"
	@echo "Docker:   docker-setup, docker-up, docker-down, docker-rebuild, docker-status"
	@echo "          docker-config, docker-logs, docker-clean-old-images"
	@echo "Local mainnet: docker-mainnet-up, docker-mainnet-rebuild, docker-mainnet-status"
	@echo "               docker-mainnet-logs, docker-mainnet-down"
	@echo "          docker-fresh-testnet (deletes the local database volume)"

dev:
	bun run dev

build:
	bun run build

build-testnet:
	bun run build:testnet

test: typecheck js-tests contracts-test

typecheck:
	bun run typecheck

js-tests:
	bun test

contracts-test:
	$(MAKE) -C contracts test

preflight-mainnet-dot:
	$(MAKE) -C contracts preflight-mainnet-dot

deploy-mainnet-dot:
	$(MAKE) -C contracts deploy-mainnet-dot

record-mainnet-dot:
	$(MAKE) -C contracts require-mainnet-rpc
	RISE_MAINNET_RPC_URL="$(MAINNET_RPC_URL)" CONFIRM_RECORD_PRODUCTION=RECORD_CURVEBALL_RISE_MAINNET_4153 bun contracts/scripts/record-production.ts

deploy-swap-mainnet-dot:
	$(MAKE) -C contracts deploy-swap-mainnet-dot

record-swap-mainnet-dot:
	$(MAKE) -C contracts require-mainnet-rpc build-icarus-swap-adapter
	RISE_MAINNET_RPC_URL="$(MAINNET_RPC_URL)" DEPLOYMENT_NETWORK=mainnet bun contracts/scripts/record-icarus-swap.ts

configure-mainnet-dot:
	bun contracts/scripts/sync-production-config.ts

configure-mainnet-host:
	python3 deploy/configure-mainnet-host.py

oracle-status-mainnet:
	$(MAKE) -C contracts oracle-status-mainnet

# Run on /opt/curveball-mainnet after source, deployment records and secrets are staged.
reset-mainnet-database:
	CONFIRM_RESET='$(CONFIRM_RESET)' bash deploy/reset-mainnet-database.sh

testnet-preflight:
	$(MAKE) -C contracts testnet-preflight

deploy-testnet-oracle:
	$(MAKE) -C contracts deploy-testnet-oracle

record-testnet-oracle:
	DEPLOYMENT_NETWORK=testnet bun contracts/scripts/record-production.ts

deploy-swap-testnet-oracle:
	$(MAKE) -C contracts deploy-swap-testnet-oracle

record-swap-testnet-oracle:
	$(MAKE) -C contracts build-icarus-swap-adapter
	DEPLOYMENT_NETWORK=testnet bun contracts/scripts/record-icarus-swap.ts

configure-testnet-oracle:
	DEPLOYMENT_NETWORK=testnet bun contracts/scripts/sync-production-config.ts

docker-setup:
	@test -f .env || { echo "Copy .env.example to .env and fill in the required values first." >&2; exit 2; }
	$(COMPOSE) config --quiet
	$(COMPOSE) up -d --build --remove-orphans $(SERVICES)

docker-up:
	$(COMPOSE) up -d --remove-orphans $(SERVICES)

docker-down:
	$(COMPOSE) down --remove-orphans

docker-rebuild:
	$(COMPOSE) up -d --build --force-recreate --remove-orphans $(SERVICES)

docker-status:
	$(COMPOSE) ps

docker-config:
	$(COMPOSE) config --quiet

docker-logs:
	$(COMPOSE) logs --follow --tail=$(TAIL)

docker-mainnet-up:
	@test "$(VITE_CHAIN_ID)" = "4153" && test "$(SOCIAL_CHAIN_ID)" = "4153" || { echo "Root .env must target RISE mainnet (4153)." >&2; exit 2; }
	$(MAKE) docker-up COMPOSE='$(MAINNET_LOCAL_COMPOSE)' SERVICES='postgres api'

docker-mainnet-rebuild:
	@test "$(VITE_CHAIN_ID)" = "4153" && test "$(SOCIAL_CHAIN_ID)" = "4153" || { echo "Root .env must target RISE mainnet (4153)." >&2; exit 2; }
	$(MAKE) docker-rebuild COMPOSE='$(MAINNET_LOCAL_COMPOSE)' SERVICES='postgres api'

docker-mainnet-status:
	$(MAKE) docker-status COMPOSE='$(MAINNET_LOCAL_COMPOSE)'

docker-mainnet-logs:
	$(MAKE) docker-logs COMPOSE='$(MAINNET_LOCAL_COMPOSE)' TAIL=$(TAIL)

docker-mainnet-down:
	$(MAKE) docker-down COMPOSE='$(MAINNET_LOCAL_COMPOSE)'

# Remove only legacy image tags that no container uses. Run after the new stack is healthy.
docker-clean-old-images:
	@set -eu; \
		used_images="$$(docker ps -a --format '{{.Image}}')"; \
		docker image ls --format '{{.Repository}}:{{.Tag}}' \
		| rg '^curveball-(social|web|frontend):' \
		| while IFS= read -r image; do \
			if printf '%s\n' "$$used_images" | rg -Fxq "$$image"; then \
				echo "Keeping $$image: a container still uses it"; \
			else \
				docker image rm "$$image"; \
			fi; \
		done

# Pin the project and file so an overridden COMPOSE cannot delete a hosted stack's volumes.
docker-fresh-testnet:
	docker compose -p curveball -f compose.yaml down --volumes --remove-orphans
	docker compose -p curveball -f compose.yaml up -d --build
