ENV_FILE := $(shell dirname "$$(git rev-parse --path-format=absolute --git-common-dir)")/.env
-include $(ENV_FILE)

export RISE_MAINNET_RPC_URL RISE_TESTNET_RPC_URL VITE_RPC_URL

COMPOSE ?= docker compose
TAIL ?= 100
SERVICE ?=

.DEFAULT_GOAL := help

.PHONY: help dev build build-testnet test typecheck contracts-test testnet-preflight deploy-testnet record-testnet configure-testnet production-preflight deploy-production record-production configure-production \
	docker-up docker-up-build docker-build docker-build-no-cache docker-down docker-stop docker-start docker-restart docker-recreate docker-rebuild \
	docker-frontend docker-social docker-migrate docker-status docker-images docker-top docker-config docker-logs docker-logs-api docker-logs-frontend docker-logs-social \
	docker-shell-api docker-shell-frontend docker-build-service docker-recreate-service docker-logs-service docker-clean

help:
	@echo "make dev                 Run the static frontend"
	@echo "make build               Build the static frontend"
	@echo "make build-testnet       Build the frontend against the recorded testnet deployment"
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
	@echo ""
	@echo "Docker Compose"
	@echo "make docker-up                 Start the stack"
	@echo "make docker-up-build           Build changed images and start the stack"
	@echo "make docker-build              Build every image"
	@echo "make docker-build-no-cache     Rebuild every image without cache"
	@echo "make docker-down               Stop and remove stack containers and networks"
	@echo "make docker-stop               Stop containers without removing them"
	@echo "make docker-start              Start previously stopped containers"
	@echo "make docker-restart            Restart containers without reloading env files"
	@echo "make docker-recreate           Recreate containers and reload env files"
	@echo "make docker-rebuild            Rebuild and recreate the complete stack"
	@echo "make docker-frontend           Rebuild and recreate only the frontend"
	@echo "make docker-social             Migrate, rebuild, and recreate social services"
	@echo "make docker-migrate            Run database migrations once"
	@echo "make docker-status             Show container status"
	@echo "make docker-images             Show Compose images"
	@echo "make docker-top                Show processes running in containers"
	@echo "make docker-config             Validate and render the Compose configuration"
	@echo "make docker-logs               Follow all logs (TAIL=100 by default)"
	@echo "make docker-logs-api           Follow API logs"
	@echo "make docker-logs-frontend      Follow frontend logs"
	@echo "make docker-logs-social        Follow API, indexer, and worker logs"
	@echo "make docker-shell-api          Open a shell in the API container"
	@echo "make docker-shell-frontend     Open a shell in the frontend container"
	@echo "make docker-build-service SERVICE=api"
	@echo "make docker-recreate-service SERVICE=api"
	@echo "make docker-logs-service SERVICE=api"
	@echo "make docker-clean              Remove stopped stack resources and orphans"

dev:
	bun run dev

build:
	bun run build

build-testnet:
	bun run build:testnet

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

# Start all existing Compose containers in the background without rebuilding images.
docker-up:
	$(COMPOSE) up -d

# Build images whose inputs changed, then start the complete stack in the background.
docker-up-build:
	$(COMPOSE) up -d --build

# Build every image defined by compose.yaml without starting containers.
docker-build:
	$(COMPOSE) build

# Rebuild every image from scratch, ignoring Docker's layer cache.
docker-build-no-cache:
	$(COMPOSE) build --no-cache

# Stop and remove this stack's containers and networks. Persistent volumes are preserved.
docker-down:
	$(COMPOSE) down --remove-orphans

# Stop running containers without removing them, so docker-start can resume them.
docker-stop:
	$(COMPOSE) stop

# Start containers previously stopped with docker-stop.
docker-start:
	$(COMPOSE) start

# Restart existing containers. This does not rebuild images or reload changed env files.
docker-restart:
	$(COMPOSE) restart

# Recreate every container so changed env files are loaded, without rebuilding images.
docker-recreate:
	$(COMPOSE) up -d --force-recreate

# Rebuild images and recreate the complete stack. Use this after broad code changes.
docker-rebuild:
	$(COMPOSE) up -d --build --force-recreate

# Rebuild and recreate only the frontend. Use this after frontend-only code changes.
docker-frontend:
	$(COMPOSE) up -d --build --force-recreate --no-deps frontend

# Apply migrations, then rebuild and recreate the API, indexer, and worker.
docker-social:
	$(COMPOSE) up -d --build --force-recreate migrate api indexer worker

# Run the one-shot database migration service and remove its temporary container afterward.
docker-migrate:
	$(COMPOSE) run --rm migrate

# Show the current state and published ports of all Compose services.
docker-status:
	$(COMPOSE) ps

# Show the images currently used by the Compose services.
docker-images:
	$(COMPOSE) images

# Show processes running inside active Compose containers.
docker-top:
	$(COMPOSE) top

# Render and validate the fully resolved Compose configuration.
docker-config:
	$(COMPOSE) config

# Follow logs from the complete stack. Override history with TAIL=<lines>.
docker-logs:
	$(COMPOSE) logs --follow --tail=$(TAIL)

# Follow only social API logs. Override history with TAIL=<lines>.
docker-logs-api:
	$(COMPOSE) logs --follow --tail=$(TAIL) api

# Follow only frontend logs. Override history with TAIL=<lines>.
docker-logs-frontend:
	$(COMPOSE) logs --follow --tail=$(TAIL) frontend

# Follow API, indexer, and worker logs together. Override history with TAIL=<lines>.
docker-logs-social:
	$(COMPOSE) logs --follow --tail=$(TAIL) api indexer worker

# Open an interactive Alpine shell inside the running API container.
docker-shell-api:
	$(COMPOSE) exec api sh

# Open an interactive Alpine shell inside the running frontend container.
docker-shell-frontend:
	$(COMPOSE) exec frontend sh

# Build one service image, for example: make docker-build-service SERVICE=api.
docker-build-service:
	@test -n "$(SERVICE)" || (echo "SERVICE is required, for example: make docker-build-service SERVICE=api" && exit 2)
	$(COMPOSE) build $(SERVICE)

# Recreate one service to reload its environment, for example SERVICE=api.
docker-recreate-service:
	@test -n "$(SERVICE)" || (echo "SERVICE is required, for example: make docker-recreate-service SERVICE=api" && exit 2)
	$(COMPOSE) up -d --force-recreate $(SERVICE)

# Follow one service's logs, for example SERVICE=worker TAIL=200.
docker-logs-service:
	@test -n "$(SERVICE)" || (echo "SERVICE is required, for example: make docker-logs-service SERVICE=api" && exit 2)
	$(COMPOSE) logs --follow --tail=$(TAIL) $(SERVICE)

# Stop the stack and remove its containers, networks, and orphaned services; preserve volumes.
docker-clean:
	$(COMPOSE) down --remove-orphans
