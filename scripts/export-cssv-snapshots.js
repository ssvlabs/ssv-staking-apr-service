#!/usr/bin/env node

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const DEFAULT_OUTPUT_DIR = 'exports/cssv-snapshots';
const WEI_DECIMALS = 18;
const DEFAULT_DB_CONFIG = {
  host: 'localhost',
  port: '5433',
  user: 'ssv_user',
  password: 'ssv_password',
  database: 'ssv_apr'
};

const RUN_HEADERS = [
  'snapshot_date',
  'snapshot_time_utc',
  'snapshot_run_id',
  'from_block_inclusive',
  'to_block_exclusive',
  'snapshot_state_block',
  'previous_snapshot_block',
  'wallet_count',
  'total_staked_wei_ssv',
  'total_staked_ssv',
  'created_at',
  'updated_at'
];

const WALLET_HEADERS = [
  'snapshot_date',
  'snapshot_time_utc',
  'snapshot_run_id',
  'wallet_address',
  'balance_wei_ssv',
  'balance_ssv',
  'gross_claimable_eth_wei',
  'gross_claimable_eth',
  'daily_reward_accrual_wei',
  'daily_reward_accrual_eth',
  'claimed_in_window_wei',
  'claimed_in_window_eth',
  'burned_dust_in_window_wei',
  'burned_dust_in_window_eth'
];

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  loadEnvFile(options.envFile);
  preventProductionExport(options);

  const outputDir = path.resolve(process.cwd(), options.out);
  const walletOutputDir = path.join(outputDir, 'wallets');
  const combinedWalletsPath = path.join(outputDir, 'snapshot-wallets.csv');

  await fs.mkdir(walletOutputDir, { recursive: true });

  const client = new Client(buildDbConfig());

  await client.connect();

  try {
    // Keep this local export utility read-only even if it is pointed at the wrong DB.
    await client.query('SET default_transaction_read_only = on');

    const snapshotRuns = await fetchSnapshotRuns(client, options);
    const runRows = snapshotRuns.map(toRunCsvRow);

    await writeCsv(
      path.join(outputDir, 'snapshot-runs.csv'),
      RUN_HEADERS,
      runRows
    );

    if (options.combined) {
      await writeCsv(combinedWalletsPath, WALLET_HEADERS, []);
    }

    let exportedWalletRows = 0;

    for (const snapshotRun of snapshotRuns) {
      const wallets = await fetchSnapshotWallets(
        client,
        snapshotRun.snapshot_run_id
      );
      const walletRows = wallets.map((wallet) =>
        toWalletCsvRow(snapshotRun, wallet)
      );

      exportedWalletRows += walletRows.length;

      await writeCsv(
        path.join(walletOutputDir, `${snapshotRun.snapshot_date}.csv`),
        WALLET_HEADERS,
        walletRows
      );

      if (options.combined) {
        await appendCsvRows(combinedWalletsPath, WALLET_HEADERS, walletRows);
      }

      if (Number(snapshotRun.wallet_count) !== walletRows.length) {
        console.warn(
          `WARNING: ${snapshotRun.snapshot_date} has wallet_count=${snapshotRun.wallet_count}, ` +
            `but exported ${walletRows.length} wallet rows`
        );
      }

      console.log(
        `Exported ${snapshotRun.snapshot_date}: ${walletRows.length} wallet rows`
      );
    }

    console.log(
      `Done. Exported ${snapshotRuns.length} snapshot days and ${exportedWalletRows} wallet rows to ${outputDir}`
    );
  } finally {
    await client.end();
  }
}

function parseArgs(argv) {
  const options = {
    out: DEFAULT_OUTPUT_DIR,
    envFile: '.env',
    from: undefined,
    to: undefined,
    combined: false,
    allowProduction: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--out':
        options.out = requireValue(argv, (index += 1), arg);
        break;
      case '--env-file':
        options.envFile = requireValue(argv, (index += 1), arg);
        break;
      case '--from':
        options.from = validateDate(requireValue(argv, (index += 1), arg), arg);
        break;
      case '--to':
        options.to = validateDate(requireValue(argv, (index += 1), arg), arg);
        break;
      case '--combined':
        options.combined = true;
        break;
      case '--allow-production':
        options.allowProduction = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];

  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function validateDate(value, flag) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${flag} must be in YYYY-MM-DD format`);
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${flag} must be a valid calendar date`);
  }

  return value;
}

function loadEnvFile(envFile) {
  const envPath = path.resolve(process.cwd(), envFile);

  if (!fsSync.existsSync(envPath)) {
    return;
  }

  const lines = fsSync.readFileSync(envPath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function preventProductionExport(options) {
  const nodeEnv = process.env.NODE_ENV;

  if (nodeEnv === 'production' && !options.allowProduction) {
    throw new Error(
      'Refusing to export with NODE_ENV=production. Re-run with --allow-production if this is intentional.'
    );
  }
}

function buildDbConfig() {
  return {
    host: envOrDefault('DATABASE_HOST', DEFAULT_DB_CONFIG.host),
    port: Number(envOrDefault('DATABASE_PORT', DEFAULT_DB_CONFIG.port)),
    user: envOrDefault('DATABASE_USER', DEFAULT_DB_CONFIG.user),
    password: envOrDefault('DATABASE_PASSWORD', DEFAULT_DB_CONFIG.password),
    database: envOrDefault('DATABASE_NAME', DEFAULT_DB_CONFIG.database),
    ssl:
      process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: false }
        : false
  };
}

function envOrDefault(key, defaultValue) {
  return process.env[key] || defaultValue;
}

async function fetchSnapshotRuns(client, options) {
  const params = [];
  const where = [];

  if (options.from) {
    params.push(options.from);
    where.push(`snapshot_date >= $${params.length}::date`);
  }

  if (options.to) {
    params.push(options.to);
    where.push(`snapshot_date <= $${params.length}::date`);
  }

  const result = await client.query(
    `
      SELECT
        id::text AS snapshot_run_id,
        snapshot_date::text AS snapshot_date,
        to_char(snapshot_time_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS snapshot_time_utc,
        previous_snapshot_block::text AS previous_snapshot_block,
        to_block_exclusive::text AS to_block_exclusive,
        snapshot_state_block::text AS snapshot_state_block,
        from_block_inclusive::text AS from_block_inclusive,
        total_staked_wei_ssv::text AS total_staked_wei_ssv,
        wallet_count::text AS wallet_count,
        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
        to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
      FROM cssv_snapshot_runs
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY snapshot_date ASC
    `,
    params
  );

  return result.rows;
}

async function fetchSnapshotWallets(client, snapshotRunId) {
  const result = await client.query(
    `
      SELECT
        wallet_address,
        balance_wei_ssv::text AS balance_wei_ssv,
        gross_claimable_eth_wei::text AS gross_claimable_eth_wei,
        daily_reward_accrual_wei::text AS daily_reward_accrual_wei,
        claimed_in_window_wei::text AS claimed_in_window_wei,
        burned_dust_in_window_wei::text AS burned_dust_in_window_wei
      FROM cssv_snapshot_wallets
      WHERE snapshot_run_id = $1::bigint
      ORDER BY wallet_address ASC
    `,
    [snapshotRunId]
  );

  return result.rows;
}

function toRunCsvRow(snapshotRun) {
  return {
    snapshot_date: snapshotRun.snapshot_date,
    snapshot_time_utc: snapshotRun.snapshot_time_utc,
    snapshot_run_id: snapshotRun.snapshot_run_id,
    from_block_inclusive: snapshotRun.from_block_inclusive,
    to_block_exclusive: snapshotRun.to_block_exclusive,
    snapshot_state_block: snapshotRun.snapshot_state_block,
    previous_snapshot_block: snapshotRun.previous_snapshot_block,
    wallet_count: snapshotRun.wallet_count,
    total_staked_wei_ssv: snapshotRun.total_staked_wei_ssv,
    total_staked_ssv: weiToDecimal(snapshotRun.total_staked_wei_ssv),
    created_at: snapshotRun.created_at,
    updated_at: snapshotRun.updated_at
  };
}

function toWalletCsvRow(snapshotRun, wallet) {
  return {
    snapshot_date: snapshotRun.snapshot_date,
    snapshot_time_utc: snapshotRun.snapshot_time_utc,
    snapshot_run_id: snapshotRun.snapshot_run_id,
    wallet_address: wallet.wallet_address,
    balance_wei_ssv: wallet.balance_wei_ssv,
    balance_ssv: weiToDecimal(wallet.balance_wei_ssv),
    gross_claimable_eth_wei: wallet.gross_claimable_eth_wei,
    gross_claimable_eth: weiToDecimal(wallet.gross_claimable_eth_wei),
    daily_reward_accrual_wei: wallet.daily_reward_accrual_wei,
    daily_reward_accrual_eth: weiToDecimal(wallet.daily_reward_accrual_wei),
    claimed_in_window_wei: wallet.claimed_in_window_wei,
    claimed_in_window_eth: weiToDecimal(wallet.claimed_in_window_wei),
    burned_dust_in_window_wei: wallet.burned_dust_in_window_wei,
    burned_dust_in_window_eth: weiToDecimal(wallet.burned_dust_in_window_wei)
  };
}

function weiToDecimal(value) {
  let amount = BigInt(value);
  const isNegative = amount < 0n;

  if (isNegative) {
    amount = -amount;
  }

  const base = 10n ** BigInt(WEI_DECIMALS);
  const whole = amount / base;
  const fraction = (amount % base)
    .toString()
    .padStart(WEI_DECIMALS, '0')
    .replace(/0+$/, '');

  return `${isNegative ? '-' : ''}${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}

async function writeCsv(filePath, headers, rows) {
  const csv = [
    headers.join(','),
    ...rows.map((row) => toCsvLine(headers, row))
  ].join('\n');

  await fs.writeFile(filePath, `${csv}\n`);
}

async function appendCsvRows(filePath, headers, rows) {
  if (rows.length === 0) {
    return;
  }

  await fs.appendFile(
    filePath,
    `${rows.map((row) => toCsvLine(headers, row)).join('\n')}\n`
  );
}

function toCsvLine(headers, row) {
  return headers.map((header) => csvEscape(row[header])).join(',');
}

function csvEscape(value) {
  const text = value === undefined || value === null ? '' : String(value);

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function printHelp() {
  console.log(`
Export persisted cSSV daily snapshots to CSV.

Usage:
  npm run export:cssv-snapshots -- [options]

Options:
  --out <dir>           Output directory. Default: ${DEFAULT_OUTPUT_DIR}
  --env-file <path>     Env file to load before connecting. Default: .env
  --from <YYYY-MM-DD>   First snapshot date to export.
  --to <YYYY-MM-DD>     Last snapshot date to export.
  --combined            Also write one combined snapshot-wallets.csv file.
  --allow-production    Allow export when NODE_ENV=production.
  -h, --help            Show this help.

Output:
  snapshot-runs.csv
  wallets/<YYYY-MM-DD>.csv
  snapshot-wallets.csv when --combined is passed

Database defaults:
  DATABASE_HOST=${DEFAULT_DB_CONFIG.host}
  DATABASE_PORT=${DEFAULT_DB_CONFIG.port}
  DATABASE_USER=${DEFAULT_DB_CONFIG.user}
  DATABASE_PASSWORD=${DEFAULT_DB_CONFIG.password}
  DATABASE_NAME=${DEFAULT_DB_CONFIG.database}
`);
}

main().catch((error) => {
  console.error(formatError(error));
  process.exitCode = 1;
});

function formatError(error) {
  if (error instanceof AggregateError && error.errors.length > 0) {
    return error.errors
      .map((nestedError) => nestedError.message || String(nestedError))
      .join('; ');
  }

  return error?.message || String(error);
}
