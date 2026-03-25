# Repository Guidelines

This file guides contributors and coding agents working in this repository. Read it before changing runtime logic, API behavior, or APR formulas.

## Project Overview

`ssv-staking-apr-service` is a NestJS microservice that calculates and stores SSV staking APR samples. It reads on-chain and explorer/oracle inputs, persists snapshots in PostgreSQL, and exposes REST endpoints for current, latest, and historical APR data.

## Project Structure & Module Organization

`src/controllers/` contains HTTP endpoints. `src/services/` contains APR logic plus external integrations such as blockchain, CoinGecko, and explorer-center clients. `src/entities/` defines TypeORM entities, `src/config/` holds database setup, and `src/migrations/` contains schema migrations. Bootstrap lives in `src/main.ts` and `src/app.module.ts`. E2E tests live in `test/`.

## Build, Test, and Development Commands

```bash
pnpm install              # install dependencies
docker-compose up -d      # start local PostgreSQL
pnpm run start:dev        # run Nest in watch mode
pnpm run build            # compile to dist/
pnpm run start:prod       # run compiled service
pnpm run lint             # run ESLint with --fix
pnpm run format           # run Prettier on src/ and test/
pnpm test                 # run Jest unit tests
pnpm run test:e2e         # run end-to-end tests
pnpm run test:cov         # generate coverage report
```

## Coding Style & Naming Conventions

Use TypeScript with NestJS DI patterns and keep modules small and explicit. Follow Prettier rules from `.prettierrc`: 2-space indentation, single quotes, and no trailing commas. Use PascalCase for classes, camelCase for methods and variables, and kebab-case for filenames such as `apr-calculation.service.ts`. Prefer explicit response shapes and avoid lossy conversions around on-chain numeric values unless the service contract requires them.

## Testing Guidelines

Jest is the active test runner. Put unit tests beside implementation as `*.spec.ts`; keep API and wiring coverage under `test/`. Add or update tests when changing APR formulas, controller response contracts, cron collection behavior, or integration failure handling. The existing `test/app.e2e-spec.ts` is still the Nest starter and should be replaced as real route coverage expands.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit prefixes such as `feat:` and `fix:`. Keep subjects short and imperative, for example `feat: add oracle fallback for effective balance`. PRs should summarize behavior changes, note required env or migration updates, link the relevant issue, and include example request/response payloads when API output changes.

## Runtime Configuration

Runtime configuration is environment-driven. Copy `.env.example` to `.env` and verify `DATABASE_*`, `RPC_URL`, `STAKING_CONTRACT_ADDRESS`, `COINGECKO_API_URL`, and explorer-center settings before local runs. Do not commit secrets or production endpoints.

## References

- `README.md` — service overview and API usage
- `QUICKSTART.md` — local setup steps
- `FLOWS.md` — contract flow definitions and implementation checks
- `SPEC.md` — technical specification and accounting rules
