# cSSV Snapshot README

## Current local mainnet defaults

Docker/local testing currently assumes:

- `ARCHIVE_RPC_URL=https://mainnet.infura.io/v3/<api-key>`
- `CHAIN_ID=1`
- `STAKING_CONTRACT_ADDRESS=0xDD9BC35aE942eF0cFa76930954a156B3fF30a4E1`
- `VIEWS_CONTRACT_ADDRESS=0xafE830B6Ee262ba11cce5F32fDCd760FFE6a66e4`
- `CSSV_TOKEN_ADDRESS=0xe018D31F120A637828F46aFD6c64EC099d960546`
- `CSSV_SNAPSHOT_START_BLOCK=24920727`

## Mainnet start block

**Edit note (April 23, 2026):** on mainnet, snapshots intentionally start at the smart contract upgrade block `24920727`.

We explicitly checked the pre-upgrade token history:

- direct RPC log scan found zero `CSSVToken.Transfer` logs before `24920727`
- manual Etherscan inspection shows the first observed `Transfer` event at block `24921023`

So no snapshot-relevant token transfer history is lost by skipping the earlier cSSV-only period.

## Required env vars

Required when `CSSV_SNAPSHOT_ENABLED=true`:

- `ARCHIVE_RPC_URL`
- `CHAIN_ID`
- `STAKING_CONTRACT_ADDRESS`
- `VIEWS_CONTRACT_ADDRESS`
- `CSSV_TOKEN_ADDRESS`
- `CSSV_SNAPSHOT_START_BLOCK`

Optional:

- `CSSV_SNAPSHOT_ENABLED` default `false`
- `LOG_CHUNK_SIZE_BLOCKS` default `2400`

`ARCHIVE_RPC_URL` must be an **archive-capable mainnet RPC** for full historical backfill because the snapshot flow performs historical `eth_call` reads at old blocks. A non-archive node or simple cluster port-forward is not enough. The existing `RPC_URL` remains for the regular APR latest-state reads.

For local mainnet testing, assume **Infura**. We explicitly do **not** document Alchemy free tier as suitable here because its `eth_getLogs` block-range limits are too restrictive for this backfill path.

## Runtime behavior

- startup backfill runs from the latest persisted snapshot until the latest eligible `12:00 UTC` day
- daily cron runs at `12:15 UTC`
- current-day snapshots are allowed once the chain is at least `10` minutes past the noon boundary
- post-commit validation is async and warn-only
- empty bootstrap-era snapshots with `wallet_count=0` and `total_staked_wei_ssv=0` are persisted quietly and skip validation
- transient RPC failures use retry backoff:
  - retry 1: `1s`
  - retry 2: `2s`
  - retry 3: `4s`
- batched wallet reads retry only failed requests; successful wallet responses are kept

Current constants:

- expected blocks per day: `7200`
- genesis timestamps:
  - mainnet `1606824023`
  - hoodi `1742213424`

## Local run

Typical local mainnet flow:

1. provision an archive-capable mainnet Infura RPC URL
2. set `ARCHIVE_RPC_URL` in `.env` or your shell environment
3. start the service with `docker compose up --build`
4. query the API on `http://localhost:3000`

Do **not** rely on a local port-forward to a non-archive execution node for backfill. The snapshot flow needs historical state reads, not just latest block access.

## Local CSV export

After the local snapshot backfill has synced, export persisted snapshot data directly from PostgreSQL:

```bash
npm run export:cssv-snapshots
```

The script loads `.env` by default, connects with the existing `DATABASE_*` variables, and writes:

- `exports/cssv-snapshots/snapshot-runs.csv`
- `exports/cssv-snapshots/wallets/<YYYY-MM-DD>.csv`

When `DATABASE_*` variables are not set, the script falls back to the local Docker Compose Postgres defaults: `localhost:5433`, `ssv_user`, `ssv_password`, `ssv_apr`.

Each wallet CSV contains raw wei columns plus decimal ETH/SSV helper columns. Empty snapshot days still produce a CSV with only headers.

Useful filters:

```bash
npm run export:cssv-snapshots -- --from 2026-04-20 --to 2026-04-28
npm run export:cssv-snapshots -- --out tmp/cssv-export --combined
```

## API

Public read endpoint:

- `GET /api/apr/snapshots/:ownerAddress`
- query params:
  - `limit` default `10`
  - `offset` default `0`

Behavior:

- valid address with rows: `200`
- valid address with no rows: `200` with `snapshots: []`
- invalid address: `400`
- if snapshot feature is disabled: `503` with `CSSV snapshot feature is disabled for this deployment`

Example:

```bash
curl -sS "http://localhost:3000/api/apr/snapshots/0xYourWalletAddress?limit=10&offset=0"
```

Internal repair endpoint:

- `POST /api/apr/admin/snapshots/repair`

Request:

```json
{
  "snapshotDate": "2026-04-23"
}
```

Response:

```json
{
  "snapshotDate": "2026-04-23",
  "deletedRuns": 1,
  "createdRuns": 1
}
```

If snapshot feature is disabled, this endpoint also returns `503` with the same explicit message.
