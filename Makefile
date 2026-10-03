.DEFAULT_GOAL := help

COMPOSE := docker compose

.PHONY: help build up down logs migrate seed test typecheck db-generate deploy-v2-testnet migrate-v2-local dev-v2-api dev-v2-web dev-v2-indexer

help:
	@echo "make build        Build the app image"
	@echo "make up           Start Postgres, the app and the indexer"
	@echo "make down         Stop the local stack"
	@echo "make logs         Follow app logs"
	@echo "make migrate      Apply database migrations"
	@echo "make seed         Insert local seed data"
	@echo "make test         Run typecheck and tests"
	@echo "make db-generate  Generate a Drizzle migration"
	@echo "make deploy-v2-testnet  Deploy V2 to RISE Testnet interactively"
	@echo "make migrate-v2-local  Migrate only the local V2 Compose database"
	@echo "make dev-v2-api       Run the V2 testnet API against local Postgres"
	@echo "make dev-v2-web       Run the V2 testnet web app locally"
	@echo "make dev-v2-indexer   Run the V2 testnet indexer against local Postgres"

build:
	$(COMPOSE) build app

up:
	$(COMPOSE) up --build --detach

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs --follow app

migrate:
	$(COMPOSE) run --rm app bun run db:migrate

seed:
	$(COMPOSE) run --rm app bun run seed

test: typecheck
	bun test

typecheck:
	bun run typecheck

db-generate:
	bun run db:generate

deploy-v2-testnet:
	@$(MAKE) -C contracts deploy-v2-testnet-interactive

migrate-v2-local:
	@test -f .env.v2.local || { echo "Create .env.v2.local from .env.example first."; exit 1; }
	bun --env-file=.env.v2.local scripts/localV2Migration.ts

dev-v2-api:
	@test -f .env.v2.local || { echo "Create .env.v2.local from .env.example first."; exit 1; }
	bun --env-file=.env.v2.local run dev:api

dev-v2-web:
	@test -f .env.v2.local || { echo "Create .env.v2.local from .env.example first."; exit 1; }
	bun --env-file=.env.v2.local run dev:web

dev-v2-indexer:
	@test -f .env.v2.local || { echo "Create .env.v2.local from .env.example first."; exit 1; }
	bun --env-file=.env.v2.local run indexer
