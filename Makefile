ENV_FILE := $(shell git rev-parse --show-toplevel)/.env
-include $(ENV_FILE)

export RISE_MAINNET_RPC_URL RISE_TESTNET_RPC_URL VITE_RPC_URL

COMPOSE ?= docker compose
MAINNET_LOCAL_COMPOSE := docker compose -p curveball-mainnet -f compose.yaml
SERVICES ?=
TAIL ?= 100

.DEFAULT_GOAL := help

.PHONY: help dev build build-testnet test typecheck js-tests contracts-test testnet-preflight deploy-testnet post-deploy-testnet set-testnet-graduation-target deploy-icarus-swap-testnet record-icarus-swap-testnet activate-icarus-swap-testnet deploy-icarus-swap-mainnet record-icarus-swap-mainnet activate-icarus-swap-mainnet record-testnet configure-testnet reset-testnet-projections activate-testnet production-preflight deploy-production record-production configure-production \
	docker-setup docker-up docker-down docker-rebuild docker-status docker-config docker-logs docker-clean-old-images docker-fresh-testnet \
	docker-mainnet-up docker-mainnet-rebuild docker-mainnet-status docker-mainnet-logs docker-mainnet-down

help:
	@echo "Build:    dev, build (mainnet), build-testnet, test"
	@echo "Testnet:  testnet-preflight, deploy-testnet, post-deploy-testnet, activate-testnet"
	@echo "          record-testnet, configure-testnet"
	@echo "          deploy-icarus-swap-testnet, record-icarus-swap-testnet, activate-icarus-swap-testnet"
	@echo "          set-testnet-graduation-target, reset-testnet-projections"
	@echo "Mainnet:  production-preflight, deploy-production, record-production, configure-production"
	@echo "          deploy-icarus-swap-mainnet, record-icarus-swap-mainnet, activate-icarus-swap-mainnet"
	@echo "Docker:   docker-setup, docker-up, docker-down, docker-rebuild, docker-status"
	@echo "          docker-config, docker-logs, docker-clean-old-images"
	@echo "Local mainnet: docker-mainnet-up, docker-mainnet-rebuild, docker-mainnet-status"
	@echo "               docker-mainnet-logs, docker-mainnet-down (keeper stays stopped)"
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

testnet-preflight:
	$(MAKE) -C contracts testnet-preflight

deploy-testnet:
	$(MAKE) -C contracts deploy-testnet

set-testnet-graduation-target:
	$(MAKE) -C contracts set-testnet-graduation-target

deploy-icarus-swap-testnet:
	$(MAKE) -C contracts deploy-icarus-swap-testnet

record-icarus-swap-testnet:
	$(MAKE) -C contracts build-icarus-swap-adapter
	DEPLOYMENT_NETWORK=testnet bun contracts/scripts/record-icarus-swap.ts

activate-icarus-swap-testnet:
	$(MAKE) configure-testnet
	$(MAKE) docker-rebuild

record-testnet:
	DEPLOYMENT_NETWORK=testnet REPLACE_TESTNET_DEPLOYMENT=1 bun contracts/scripts/record-production.ts

configure-testnet:
	DEPLOYMENT_NETWORK=testnet bun contracts/scripts/sync-production-config.ts

reset-testnet-projections:
	@set -eu; \
		new_launchpad="$$(jq -er 'select(.chainId == 11155931) | .launchpad | select(type == "string" and test("^0x[0-9a-fA-F]{40}$$"))' deployments/11155931/curveball.json)" || { echo "A valid testnet launchpad record is required before stopping services." >&2; exit 2; }; \
		$(COMPOSE) config --quiet; \
		was_running="$$( $(COMPOSE) ps --services --status running )"; \
		restore() { \
			result="$$1"; trap - EXIT; \
			if { test "$$result" -ne 0 || test "$(RESET_LEAVE_STOPPED)" != "1"; } && test -n "$$was_running"; then \
				$(COMPOSE) up -d $$was_running || { echo "Failed to restore previously running services." >&2; exit 1; }; \
			fi; \
			exit "$$result"; \
		}; \
		trap 'restore "$$?"' EXIT; \
		$(COMPOSE) stop api keeper; \
		$(COMPOSE) up -d postgres; \
		$(COMPOSE) exec -T postgres psql -U curveball -d curveball -v ON_ERROR_STOP=1 -v new_launchpad="$$new_launchpad" -f /dev/stdin < deploy/reset-local-testnet-projections.sql

activate-testnet:
	$(MAKE) record-testnet
	$(MAKE) configure-testnet
	$(MAKE) reset-testnet-projections RESET_LEAVE_STOPPED=1
	$(MAKE) docker-rebuild

# Run after deploy-testnet: activate the recorded release, then broadcast a small smoke launch/buy.
post-deploy-testnet:
	$(MAKE) activate-testnet
	$(MAKE) -C contracts smoke-testnet

production-preflight:
	$(MAKE) -C contracts production-preflight

deploy-production:
	$(MAKE) -C contracts deploy-production

record-production:
	bun contracts/scripts/record-production.ts

configure-production:
	bun contracts/scripts/sync-production-config.ts

deploy-icarus-swap-mainnet:
	$(MAKE) -C contracts deploy-icarus-swap-mainnet

record-icarus-swap-mainnet:
	$(MAKE) -C contracts require-mainnet-rpc build-icarus-swap-adapter
	@DEPLOYMENT_NETWORK=mainnet bun contracts/scripts/record-icarus-swap.ts

activate-icarus-swap-mainnet:
	@test -f deployments/4153/icarus-swap-adapter.json || { echo "Record the mainnet swap adapter first."; exit 2; }
	$(MAKE) configure-production
	bun deploy/prepare-production-env.mjs --network mainnet
	docker compose --env-file deploy/production.env -f compose.production.yaml -f deploy/compose.mainnet.yaml config --quiet
	docker compose --env-file deploy/production.env -f compose.production.yaml -f deploy/compose.mainnet.yaml build

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
