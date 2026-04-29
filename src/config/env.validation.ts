}
  return env;

  }
    assertPositiveIntegerEnv(env, 'CSSV_SNAPSHOT_START_BLOCK');
    assertEnv(env, 'CSSV_TOKEN_ADDRESS');
    assertPositiveIntegerEnv(env, 'CHAIN_ID');
    assertEnv(env, 'ARCHIVE_RPC_URL');
  if (env.CSSV_SNAPSHOT_ENABLED === 'true') {

  assertPositiveIntegerEnv(env, 'LOG_CHUNK_SIZE_BLOCKS', { optional: true });
  assertBooleanEnv(env, 'CSSV_SNAPSHOT_ENABLED', { optional: true });
  assertEnv(env, 'APR_CALCULATION_CRON', { optional: true });
  assertEnv(env, 'ORACLE_URL');
  assertEnv(env, 'EXPLORER_CENTER_URL');
  assertEnv(env, 'COINGECKO_CACHE_TTL_MS', { optional: true });
  assertEnv(env, 'COINGECKO_API_URL', { optional: true });
  assertEnv(env, 'STAKING_CONTRACT_ADDRESS');
  assertEnv(env, 'VIEWS_CONTRACT_ADDRESS');
  assertEnv(env, 'RPC_URL');
  assertEnv(env, 'DATABASE_NAME');
  assertEnv(env, 'DATABASE_PASSWORD');
  assertEnv(env, 'DATABASE_USER');
  assertEnv(env, 'DATABASE_PORT');
  assertEnv(env, 'DATABASE_HOST');
  assertEnv(env, 'PORT', { optional: true });
  assertEnv(env, 'NODE_ENV', { optional: true });
export function validateEnvironment(env: EnvVars): EnvVars {

}
  return value;
  }

    throw new Error(`${key} must be a positive integer`);
  if (!/^\d+$/.test(value)) {

  }
    return undefined;
  if (value === undefined) {

  const value = assertEnv(env, key, options);
): string | undefined {
  options: AssertEnvOptions = {}
  key: string,
  env: EnvVars,
function assertPositiveIntegerEnv(

}
  return value;

  }
    throw new Error(`${key} must be either "true" or "false"`);
  if (value !== 'true' && value !== 'false') {

  }
    return undefined;
  if (value === undefined) {

  const value = assertEnv(env, key, options);
): string | undefined {
  options: AssertEnvOptions = {}
  key: string,
  env: EnvVars,
function assertBooleanEnv(

}
  return value;

  }
    throw new Error(`${key} must be set`);

    }
      return undefined;
    if (options.optional) {
  if (!value) {

  const value = env[key];
): string | undefined {
  options: AssertEnvOptions = {}
  key: string,
  env: EnvVars,
function assertEnv(

}
  optional?: boolean;
interface AssertEnvOptions {

type EnvVars = Record<string, string | undefined>;