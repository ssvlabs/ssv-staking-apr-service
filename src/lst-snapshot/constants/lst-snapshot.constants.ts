export const LST_SNAPSHOT_CRON_EXPRESSION = '0 14 * * *';
export const LST_SNAPSHOT_CRON_TIME_ZONE = 'UTC';
export const LST_SNAPSHOT_LOCK_NAMESPACE = 42_002;
export const LST_SNAPSHOT_LOCK_KEY = 1;
export const LST_SNAPSHOT_BALANCE_BATCH_SIZE = 100;
export const LST_SNAPSHOT_RPC_MAX_RETRIES = 3;
export const LST_SNAPSHOT_RPC_RETRY_BASE_DELAY_MS = 1_000;
export const DEFAULT_LST_LOG_CHUNK_SIZE_BLOCKS = 2_400;

export interface LstTokenConfig {
  symbol: string;
  address: string;
  deploymentBlock: number;
}

// Deployment blocks verified on-chain (Blockscout). Values are set just below
// the actual contract creation block so no early transfer is ever missed.
export const LST_TOKENS: readonly LstTokenConfig[] = [
  {
    symbol: 'LDO',
    address: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32',
    deploymentBlock: 11_400_000   // created at 11,473,588
  },
  {
    symbol: 'stETH',
    address: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
    deploymentBlock: 11_400_000   // created at 11,480,180
  },
  {
    symbol: 'eETH',
    address: '0x35fA164735182de50811E8e2E824cFb9B6118ac2',
    deploymentBlock: 17_664_000   // created at 17,664,324
  },
  {
    symbol: 'weETH',
    address: '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee',
    deploymentBlock: 17_664_000   // created at 17,664,336
  },
  {
    symbol: 'pufETH',
    address: '0xD9A442856C234a39a81a089C06451EBAa4306a72',
    deploymentBlock: 19_128_000   // created at 19,128,052
  },
  {
    symbol: 'mETH',
    address: '0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa',
    deploymentBlock: 18_290_000   // created at 18,290,587
  },
  {
    symbol: 'OETH',
    address: '0x856c4Efb76C1D1AE02e20CEB03A2A6a08b0b8dC3',
    deploymentBlock: 16_935_000   // created at 16,935,267
  }
] as const;
