# cSSV Daily Snapshot — Delivery Tasks

This file is preserved as the historical delivery plan used during implementation.

It is **not** the live status board for the current codebase, so the unchecked items below should not be read as “feature missing”. Use the implementation, tests, and the architecture/readme docs as the source of truth for current behavior.

Scope assumptions:

- Architecture in [CSSV_DAILY_SNAPSHOT_ARCHITECTURE.md](./CSSV_DAILY_SNAPSHOT_ARCHITECTURE.md) is frozen.
- Scope here is **development only**.
- The feature is implemented inside **`ssv-staking-apr-service`**.
- No new deployment shape is required for v1.
- Saturdays and Sundays are non-working days and are excluded from this schedule.

Target by **2026-04-27**:

- snapshot job implemented inside `ssv-staking-apr-service`
- PostgreSQL schema in place
- startup backfill implemented
- PostgreSQL advisory lock implemented
- APR service API endpoint implemented
- tests and docs in reviewable state

---

## 2026-04-16 (Thu) — Scaffold NestJS modules and freeze interfaces

- [ ] Create a dedicated cSSV snapshot working area inside the service.
- [ ] Decide module shape:
  - extend `AprCalculationService`
  - or create dedicated snapshot module/services
- [ ] Define main components:
  - blockchain/log reader service
  - advisory lock service
  - repository/data access layer
  - snapshot orchestration service
  - API read service
- [ ] Define config/env contract for:
  - RPC URL
  - PostgreSQL URL / TypeORM settings
  - `CSSVToken` address
  - `SSVStaking` / views addresses if needed
  - start block
  - `EXPECTED_BLOCKS_PER_DAY`
  - `LOG_CHUNK_SIZE_BLOCKS`
  - cron expression for snapshot job
- [ ] Decide ABI/event loading approach for:
  - `Transfer`
  - `RewardsSettled`
  - `RewardsClaimed`
  - `previewClaimableEth`
  - `totalStaked`
  - `stakedBalanceOf`
- [ ] Freeze internal TypeScript types for:
  - run row
  - wallet row
  - in-memory wallet state

Exit criteria:

- service structure is clear
- config contract is explicit
- core interfaces can be implemented without reworking the architecture

---

## 2026-04-17 (Fri) — TypeORM migration, schema, lock, and boundary finder

- [ ] Add TypeORM migration for:
  - `cssv_snapshot_runs`
  - `cssv_snapshot_wallets`
  - wallet address index
- [ ] Decide whether to map snapshot tables as TypeORM entities, raw queries, or hybrid.
- [ ] Implement repository methods for:
  - fetch latest run
  - fetch wallet rows by run
  - insert run
  - bulk insert wallet rows
  - delete snapshot day and later days for recovery
- [ ] Enforce canonical checksummed address storage in persistence layer.
- [ ] Make all large numeric values map cleanly to string / bigint handling.
- [ ] Implement PostgreSQL advisory lock using dedicated `QueryRunner`.
- [ ] Implement boundary finder:
  - start from `prevSnapshotBlock + EXPECTED_BLOCKS_PER_DAY`
  - refine with block timestamps
  - binary search to first block strictly after `12:00:00 UTC`
- [ ] Implement `snapshotStateBlock = toBlockExclusive - 1`.
- [ ] Add tests for migration/repository basics, lock behavior, and boundary logic.

Exit criteria:

- schema can be created locally
- latest snapshot query works by `snapshot_date desc`
- advisory lock can block concurrent runs
- boundary logic is deterministic

---

## 2026-04-20 (Mon) — Expand blockchain service for historical reads and logs

- [ ] Extend blockchain access beyond current APR view calls.
- [ ] Add historical block helpers:
  - get block header by number
  - get latest block
  - block-tagged contract reads
- [ ] Implement chunked `eth_getLogs` reader for `[fromBlockInclusive, toBlockExclusive)`.
- [ ] Decode and normalize:
  - `CSSVToken.Transfer`
  - `SSVStaking.RewardsSettled`
  - `SSVStaking.RewardsClaimed`
- [ ] Sort merged logs globally by:
  - `blockNumber`
  - `transactionIndex`
  - `logIndex`
- [ ] Group claim-related logs by `transactionHash + user`.
- [ ] Add tests for:
  - pagination/chunk merge
  - mixed event ordering
  - paired vs standalone `RewardsSettled`

Exit criteria:

- service can read one day of logs safely
- event stream is replay-ready and correctly ordered

---

## 2026-04-21 (Tue) — In-memory replay, query set, and accrual computation

- [ ] Implement previous-snapshot load into in-memory wallet map.
- [ ] Implement `Transfer` replay:
  - mint
  - burn
  - wallet-to-wallet transfer
- [ ] Implement claim replay:
  - `claimed_in_window_wei`
  - `burned_dust_in_window_wei`
- [ ] Enforce exact dust rule:
  - `remainder = accrued - payout`
  - burn only when `balance_at_claim == 0 && remainder > 0`
- [ ] Ignore standalone `RewardsSettled` not paired with `RewardsClaimed` in same `transactionHash + user`.
- [ ] Build wallet query set from:
  - previous snapshot wallets
  - transfer-touched wallets
  - claim users
  - paired `RewardsSettled` users
- [ ] Implement batched `previewClaimableEth(wallet)` calls at `snapshotStateBlock`.
- [ ] Compute per-wallet:
  - `current_preview`
  - `previous_preview`
  - `daily_reward_accrual`
- [ ] Implement persist-or-drop decision:
  - keep wallet row only if one of the architecture conditions is true
- [ ] Add service-level tests for:
  - first-time wallets
  - zero-balance claim dust
  - multiple transfers before claim
  - multiple claim txs in one day
  - no-activity wallets
  - zero-balance but claimable wallets
  - claimed-only wallets
  - dropped-zero rows

Exit criteria:

- replay matches contract semantics
- claim accounting is exact
- snapshot rows can be built end-to-end in memory for one day

---

## 2026-04-22 (Wed) — Snapshot orchestration, cron, and startup backfill

- [ ] Implement one-day snapshot execution flow:
  - acquire advisory lock
  - load previous snapshot
  - find boundary
  - read logs
  - replay
  - batch `previewClaimableEth`
  - compute rows
  - write run + wallet rows in one transaction
  - release advisory lock
- [ ] Add scheduled execution around `12:15 UTC`.
- [ ] Implement backfill loop on startup until latest eligible day.
- [ ] Ensure rerun safety if transaction fails mid-day processing.
- [ ] Use bulk insert / raw SQL strategy for wallet rows.
- [ ] Add integration-style tests for:
  - first snapshot creation
  - second day based on previous snapshot
  - backfill over multiple days
  - duplicate-run avoidance via advisory lock

Exit criteria:

- service can build and persist consecutive daily snapshots
- startup catch-up path uses the same code as the daily path
- cron path is lock-protected

---

## 2026-04-23 (Thu) — Recovery and deletion

- [ ] Implement crash recovery behavior:
  - always resume from latest persisted snapshot
  - rebuild in-memory state from DB
- [ ] Implement repair helper path:
  - delete one affected day and later days
  - rerun backfill from last known-good snapshot
- [ ] Add tests for:
  - recovery from bad day deletion
  - restart after partial day failure

Exit criteria:

- runtime recovery story is implemented

---

## 2026-04-24 (Fri) — APR service API endpoint and Swagger contract

- [ ] Add `GET /api/apr/snapshots/:ownerAddress`.
- [ ] Validate input address and normalize it to checksum form.
- [ ] Implement read query joining wallet rows with run rows.
- [ ] Enforce latest-first ordering:
  - `order by snapshot_date desc`
- [ ] Support committed v1 query params:
  - `limit`
  - `offset`
- [ ] Map internal block fields to public API fields:
  - `fromBlock = from_block_inclusive`
  - `toBlock = snapshot_state_block`
- [ ] Return wei values as JSON strings.
- [ ] Return `200` with empty `snapshots: []` for valid address with no rows.
- [ ] Add request/response DTOs for the snapshot endpoint.
- [ ] Add Swagger decorators for all fields:
  - `snapshotDate`
  - `snapshotTimeUtc`
  - `fromBlock`
  - `toBlock`
  - `balanceWeiSsv`
  - `dailyRewardAccrualWei`
  - `grossClaimableEthWei`
  - `claimedInWindowWei`
  - `burnedDustInWindowWei`
- [ ] Make sure accounting fields are described clearly, especially:
  - why `burnedDustInWindowWei` exists
  - per-claim `< 100000 wei` bound
- [ ] Add controller/e2e tests for:
  - valid address with rows
  - valid address with no rows
  - invalid address
  - latest-first ordering

Exit criteria:

- mandatory consumer endpoint is working
- API hides internal `toBlockExclusive` / `snapshotStateBlock` semantics
- endpoint contract is documented and consumer-safe

---

## 2026-04-27 (Mon) — End-to-end test pass, bugfix buffer, and review-ready freeze

- [ ] Run end-to-end local flow for:
  - first snapshot
  - consecutive snapshots
  - startup catch-up
  - API read after write
  - advisory-lock skip path
- [ ] Verify JSON-RPC batching for `previewClaimableEth` is efficient enough for expected wallet counts.
- [ ] Review log chunk size and bulk insert settings for obvious bottlenecks.
- [ ] Fix correctness bugs found by integration testing.
- [ ] Add final missing tests around:
  - paired claim handling
  - boundary block edges
  - zero-value row dropping
  - advisory lock cleanup on failure
- [ ] Final bugfix pass from testing feedback.
- [ ] Review code for simplification opportunities without changing frozen architecture.
- [ ] Clean up logs, error wrapping, and comments.
- [ ] Verify docs in `docs/cssv-snapshot` are consistent:
  - architecture
  - tasks
  - config notes if added
- [ ] Prepare review checklist:
  - migration/schema
  - advisory lock
  - replay logic
  - backfill
  - API
  - swagger
  - tests

Exit criteria:

- no known correctness gaps in main happy path
- performance is acceptable for v1 scope
- implementation is review-ready

---

## Milestones

- **By 2026-04-17:** schema, repository layer, advisory lock, and boundary finder ready
- **By 2026-04-21:** log replay and daily accrual computation ready
- **By 2026-04-22:** daily snapshot creation, startup backfill, and scheduled execution working
- **By 2026-04-24:** APR service endpoint and Swagger contract ready
- **By 2026-04-27:** end-to-end test pass complete and implementation frozen for review

---

## Stretch Goals

Only start these if the committed scope is already in good shape.

- [ ] Add optional API date filters:
  - `fromDate`
  - `toDate`
- [ ] Filter by `snapshot_date` while keeping latest-first ordering:
  - `order by snapshot_date desc`
- [ ] Add API tests for date filtering behavior.
- [ ] Implement post-commit validation service for:
  - `totalStaked` sum check
  - sampled `stakedBalanceOf`
  - sampled `previewClaimableEth`
  - sampled claim identity checks
- [ ] Make validation warn-only:
  - no rollback
  - no publish gate
  - structured warn logs with run/date/address/tx context
- [ ] Add tests for:
  - validation warnings
