type EnvVars = Record<string, string | undefined>;

interface AssertEnvOptions {
  optional?: boolean;
}

function assertEnv(
  env: EnvVars,
  key: string,
  options: AssertEnvOptions = {}
): string | undefined {
  const value = env[key];

  if (!value) {
    if (options.optional) {
      return undefined;
    }

    throw new Error(`${key} must be set`);
  }

  return value;
}

function assertBooleanEnv(
  env: EnvVars,
  key: string,
  options: AssertEnvOptions = {}
): string | undefined {
  const value = assertEnv(env, key, options);

  if (value === undefined) {
    return undefined;
  }

  if (value !== 'true' && value !== 'false') {
    throw new Error(`${key} must be either "true" or "false"`);
  }

  return value;
}

function assertPositiveIntegerEnv(
  env: EnvVars,
  key: string,
  options: AssertEnvOptions = {}
): string | undefined {
  const value = assertEnv(env, key, options);

  if (value === undefined) {
    return undefined;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`${key} must be a positive integer`);
  }

  return value;
}

export function validateEnvironment(env: EnvVars): EnvVars {
  assertEnv(env, 'NODE_ENV', { optional: true });
  assertEnv(env, 'PORT', { optional: true });
  assertEnv(env, 'DATABASE_HOST');
  assertEnv(env, 'DATABASE_PORT');
  assertEnv(env, 'DATABASE_USER');
  assertEnv(env, 'DATABASE_PASSWORD');
  assertEnv(env, 'DATABASE_NAME');
  assertEnv(env, 'RPC_URL');
  assertEnv(env, 'VIEWS_CONTRACT_ADDRESS');
  assertEnv(env, 'STAKING_CONTRACT_ADDRESS');
  assertEnv(env, 'COINGECKO_API_URL', { optional: true });
  assertEnv(env, 'COINGECKO_CACHE_TTL_MS', { optional: true });
  assertEnv(env, 'EXPLORER_CENTER_URL');
  assertEnv(env, 'ORACLE_URL');
  assertEnv(env, 'APR_CALCULATION_CRON', { optional: true });
  assertBooleanEnv(env, 'CSSV_SNAPSHOT_ENABLED', { optional: true });
  assertBooleanEnv(env, 'LST_SNAPSHOT_ENABLED', { optional: true });
  assertPositiveIntegerEnv(env, 'LOG_CHUNK_SIZE_BLOCKS', { optional: true });

  if (env.CSSV_SNAPSHOT_ENABLED === 'true') {
    assertEnv(env, 'ARCHIVE_RPC_URL');
    assertPositiveIntegerEnv(env, 'CHAIN_ID');
    assertEnv(env, 'CSSV_TOKEN_ADDRESS');
    assertPositiveIntegerEnv(env, 'CSSV_SNAPSHOT_START_BLOCK');
  }

  if (env.LST_SNAPSHOT_ENABLED === 'true') {
    assertEnv(env, 'ARCHIVE_RPC_URL');
    assertPositiveIntegerEnv(env, 'CHAIN_ID');
  }

  return env;
}
