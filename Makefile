.PHONY: db generate migrate api web build test test-e2e grid-check admin embed

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
	go build -o bin/mahaam ./cmd/api

test: ## Unit tests + CI guards (scopes, sqlc tenant predicate, authz)
	go test -count=1 ./...

test-e2e: ## Cross-workspace isolation sweep over every route (throwaway DB)
	docker exec mahaam-postgres psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='mahaam_test'" | grep -q 1 || \
	  docker exec mahaam-postgres psql -U postgres -c "CREATE DATABASE mahaam_test"
	TEST_DATABASE_URL="postgres://postgres:postgres@localhost:55460/mahaam_test?sslmode=disable" \
	TEST_APP_DATABASE_URL="postgres://mahaam_app_test:test@localhost:55460/mahaam_test?sslmode=disable" \
	go test -count=1 ./internal/server/ -run 'ViewAs|Isolation|TimeTracking|Reports|MCPSession|IssueLoop|Vault|Access|Integrations|Billing|PersonalAccessTokens|PasswordReset|TestProfile|AccountDeletion|NativePush|EmailVerification|TwoFactor|AuthPluginSurface|BoardRealtime|LiveActivity|SelfMonitoring|CircleXO|AppleSignIn|AppleWeb|AppleRevoke|OAuth|SocialIdentities|Passwordless|CommentModeration' -v
	# The realtime bus needs only the owner URL: it opens its own LISTEN connection.
	TEST_DATABASE_URL="postgres://postgres:postgres@localhost:55460/mahaam_test?sslmode=disable" \
	go test -count=1 ./internal/live/ -v

grid-check: ## Fail if the mobile grid / feedback-sdk copies drifted from fadymondy.com-v2
	cd apps/mobile && npm run -s grid:check

embed: ## Bundle the embeddable feedback widget IIFE -> embed/dist/v1.js
	cd web && npx --yes esbuild ../embed/src/widget.ts --bundle --format=iife --minify --target=es2019 --outfile=../embed/dist/v1.js
