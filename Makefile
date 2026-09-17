.DEFAULT_GOAL := help

COMPOSE := docker compose

.PHONY: help build up down logs migrate seed test typecheck db-generate

help:
	@echo "make build        Build the app image"
	@echo "make up           Start Postgres, the app and the indexer"
	@echo "make down         Stop the local stack"
	@echo "make logs         Follow app logs"
	@echo "make migrate      Apply database migrations"
	@echo "make seed         Insert local seed data"
	@echo "make test         Run typecheck and tests"
	@echo "make db-generate  Generate a Drizzle migration"

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
