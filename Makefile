.PHONY: db generate migrate api web build test test-e2e grid-check admin

db: ## Start Postgres (docker, :55460)
	docker compose up -d

generate: ## sqlc -> gqlgen -> OpenAPI export (the integration gate)
	togo generate

migrate: ## Schema + app role + constraints + RLS (idempotent)
	go run ./cmd/migrate

api: ## API on :8110
	go run ./cmd/api

web: ## Web on :3010
	cd web && npm run dev

build: ## Build the API binary
	go build -o bin/managy ./cmd/api

test: ## Unit tests + CI guards (scopes, sqlc tenant predicate, authz)
	go test -count=1 ./...

test-e2e: ## Cross-workspace isolation sweep over every route (throwaway DB)
	docker exec managy-postgres psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='managy_test'" | grep -q 1 || \
	  docker exec managy-postgres psql -U postgres -c "CREATE DATABASE managy_test"
	TEST_DATABASE_URL="postgres://postgres:postgres@localhost:55460/managy_test?sslmode=disable" \
	TEST_APP_DATABASE_URL="postgres://managy_app_test:test@localhost:55460/managy_test?sslmode=disable" \
	go test -count=1 ./internal/server/ -run 'Isolation|TimeTracking|Reports|MCPSession' -v

grid-check: ## Fail if the grid / feedback-sdk copies drifted from fadymondy.com-v2
	cd web && npm run grid:check
