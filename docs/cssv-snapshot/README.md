# cSSV Snapshot Local Setup

Local defaults in this service are currently wired to the Hoodi prod public contracts:

- `CHAIN_ID=560048`
- `STAKING_CONTRACT_ADDRESS=0x58410Bef803ECd7E63B23664C586A6DB72DAf59c`
- `VIEWS_CONTRACT_ADDRESS=0x5AdDb3f1529C5ec70D77400499eE4bbF328368fe`
- `CSSV_TOKEN_ADDRESS=0x6e1a5d27361c666f681af06535c8Ac773E571d4d`
- `CSSV_DEPLOYMENT_BLOCK=2219319`

Required env vars for the snapshot module when `CSSV_SNAPSHOT_ENABLED=true`:

- `RPC_URL`
- `CHAIN_ID`
- `STAKING_CONTRACT_ADDRESS`
- `VIEWS_CONTRACT_ADDRESS`
- `CSSV_TOKEN_ADDRESS`
- `CSSV_DEPLOYMENT_BLOCK`

Optional:

- `CSSV_SNAPSHOT_ENABLED` default `false`
- `LOG_CHUNK_SIZE_BLOCKS` default `2400`

Current hard-coded constants:

- daily cron: `12:15 UTC`
- expected blocks per day: `7200`
- genesis timestamps:
  - mainnet `1606824023`
  - hoodi `1742213424`
