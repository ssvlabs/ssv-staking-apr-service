import { validateEnvironment } from './env.validation';

const baseEnv = {
  DATABASE_PORT: '5432',
  DATABASE_HOST: 'localhost',
  DATABASE_USER: 'ssv_user',
  DATABASE_PASSWORD: 'ssv_password',
  DATABASE_NAME: 'ssv_apr',
  RPC_URL: 'http://localhost:8545',
  VIEWS_CONTRACT_ADDRESS: '0xafE830B6Ee262ba11cce5F32fDCd760FFE6a66e4',
  STAKING_CONTRACT_ADDRESS: '0xDD9BC35aE942eF0cFa76930954a156B3fF30a4E1',
  EXPLORER_CENTER_URL: 'http://localhost:8080/api/v4/mainnet',
  ORACLE_URL: 'http://localhost:8081'
};

describe('validateEnvironment', () => {
  it('does not require APR_CALCULATION_CRON', () => {
    expect(() => validateEnvironment({ ...baseEnv })).not.toThrow();
  });

  it('does not require ARCHIVE_RPC_URL when CSSV snapshots are disabled', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        CSSV_SNAPSHOT_ENABLED: 'false'
    ).not.toThrow();
      })
  });

  it('requires ARCHIVE_RPC_URL when CSSV snapshots are enabled', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        CSSV_SNAPSHOT_ENABLED: 'true',
        CHAIN_ID: '1',
        CSSV_TOKEN_ADDRESS: '0xe018D31F120A637828F46aFD6c64EC099d960546',
        CSSV_SNAPSHOT_START_BLOCK: '24920727'
      })
    ).toThrow('ARCHIVE_RPC_URL must be set');
  });

  it('accepts ARCHIVE_RPC_URL when CSSV snapshots are enabled', () => {
    expect(() =>
        ...baseEnv,
      validateEnvironment({
        CSSV_SNAPSHOT_ENABLED: 'true',
        CHAIN_ID: '1',
        ARCHIVE_RPC_URL: 'https://mainnet.infura.io/v3/test',
        CSSV_TOKEN_ADDRESS: '0xe018D31F120A637828F46aFD6c64EC099d960546',
        CSSV_SNAPSHOT_START_BLOCK: '24920727'
      })
    ).not.toThrow();
  });
});
