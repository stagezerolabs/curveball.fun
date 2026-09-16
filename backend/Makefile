.DEFAULT_GOAL := help

COMPOSE := docker compose

.PHONY: help build up down logs migrate seed test typecheck db-generate

help:
	@echo "make build        Build the backend image"
	@echo "make up           Start Postgres and the backend"
	@echo "make down         Stop the local stack"
	@echo "make logs         Follow backend logs"
	@echo "make migrate      Apply database migrations"
	@echo "make seed         Insert local seed data"
	@echo "make test         Run typecheck and tests"
	@echo "make db-generate  Generate a Drizzle migration"

build:
	$(COMPOSE) build backend

up:
	$(COMPOSE) up --build --detach

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs --follow backend

migrate:
	$(COMPOSE) run --rm backend bun run db:migrate

seed:
	$(COMPOSE) run --rm backend bun run seed

test: typecheck
	bun test

typecheck:
	bun run typecheck

db-generate:
	bun run db:generate
