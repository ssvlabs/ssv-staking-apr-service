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
  assertEnv(env, 'EXPLORER_CENTER_URL');
  assertEnv(env, 'ORACLE_URL');

  return env;
}
