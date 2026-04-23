# cSSV Snapshot Local Setup

Current local mainnet defaults for Docker/local testing:

- `RPC_URL=http://localhost:8545` for a host-side port-forward
- `CHAIN_ID=1`
- `STAKING_CONTRACT_ADDRESS=0xDD9BC35aE942eF0cFa76930954a156B3fF30a4E1`
- `VIEWS_CONTRACT_ADDRESS=0xafE830B6Ee262ba11cce5F32fDCd760FFE6a66e4`
- `CSSV_TOKEN_ADDRESS=0xe018D31F120A637828F46aFD6c64EC099d960546`
- `CSSV_SNAPSHOT_START_BLOCK=24920727`

**Edit note (April 23, 2026):** on mainnet, snapshots intentionally start at the smart contract upgrade block `24920727`.

We explicitly checked the pre-upgrade token history:

- direct RPC log scan found zero `CSSVToken.Transfer` logs before `24920727`
- manual Etherscan inspection shows the first observed `Transfer` event at block `24921023`

So no snapshot-relevant token transfer history is lost by skipping the earlier cSSV-only period.

Required env vars for the snapshot module when `CSSV_SNAPSHOT_ENABLED=true`:

- `RPC_URL`
- `CHAIN_ID`
- `STAKING_CONTRACT_ADDRESS`
- `VIEWS_CONTRACT_ADDRESS`
- `CSSV_TOKEN_ADDRESS`
- `CSSV_SNAPSHOT_START_BLOCK`

Optional:

- `CSSV_SNAPSHOT_ENABLED` default `false`
- `LOG_CHUNK_SIZE_BLOCKS` default `2400`

Current hard-coded constants:

- daily cron: `12:15 UTC`
- expected blocks per day: `7200`
- genesis timestamps:
  - mainnet `1606824023`
  - hoodi `1742213424`
