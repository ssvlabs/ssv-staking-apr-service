import { DataSource } from 'typeorm';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import {
  AprSample,
  CssvSnapshotRun,
  CssvSnapshotWallet
} from '../src/entities';
import { CreateAprSamplesTable20260209133000 } from '../src/migrations/20260209133000-create-apr-samples';
import { CreateCssvSnapshotTables20260417090000 } from '../src/migrations/20260417090000-create-cssv-snapshot-tables';
import { CssvSnapshotAdvisoryLockService } from '../src/cssv-snapshot/services/cssv-snapshot-advisory-lock.service';
import { CssvSnapshotQueryService } from '../src/cssv-snapshot/services/cssv-snapshot-query.service';
import { CssvSnapshotWriterService } from '../src/cssv-snapshot/services/cssv-snapshot-writer.service';

describe('CSSV snapshot Postgres integration', () => {
  let container: StartedTestContainer;
  let dataSource: DataSource;
  let queryService: CssvSnapshotQueryService;
  let writerService: CssvSnapshotWriterService;
  let lockService: CssvSnapshotAdvisoryLockService;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_DB: 'ssv_apr_test',
        POSTGRES_USER: 'ssv_user',
        POSTGRES_PASSWORD: 'ssv_password'
      })
      .withExposedPorts(5432)
      .withWaitStrategy(
        Wait.forLogMessage(
          /database system is ready to accept connections/i,
          2
        )
      )
      .withStartupTimeout(120_000)
      .start();

    dataSource = new DataSource({
      type: 'postgres',
      host: container.getHost(),
      port: container.getMappedPort(5432),
      username: 'ssv_user',
      password: 'ssv_password',
      database: 'ssv_apr_test',
      entities: [AprSample, CssvSnapshotRun, CssvSnapshotWallet],
      migrations: [
        CreateAprSamplesTable20260209133000,
        CreateCssvSnapshotTables20260417090000
      ],
      synchronize: false
    });
    await initializeDataSourceWithRetry(dataSource);
    await dataSource.runMigrations();

    queryService = new CssvSnapshotQueryService(
      dataSource.getRepository(CssvSnapshotRun),
      dataSource.getRepository(CssvSnapshotWallet)
    );
    writerService = new CssvSnapshotWriterService(
      dataSource.getRepository(CssvSnapshotRun),
      dataSource.getRepository(CssvSnapshotWallet)
    );
    lockService = new CssvSnapshotAdvisoryLockService(dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }

    if (container) {
      await container.stop();
    }
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE "cssv_snapshot_runs" CASCADE');
  });

  it('runs migrations and creates the snapshot tables', async () => {
    const [runsTable] = (await dataSource.query(
      `select to_regclass('public.cssv_snapshot_runs') as name`
    )) as Array<{ name: string | null }>;
    const [walletsTable] = (await dataSource.query(
      `select to_regclass('public.cssv_snapshot_wallets') as name`
    )) as Array<{ name: string | null }>;

    expect(runsTable.name).toBe('cssv_snapshot_runs');
    expect(walletsTable.name).toBe('cssv_snapshot_wallets');
  });

  it('persists, reads, orders, and deletes snapshot rows', async () => {
    const walletAddress = '0x58410bef803ecd7e63b23664c586a6db72daf59c';

    const firstRun = await writerService.insertSnapshotRun({
      snapshotDate: '2026-04-16',
      snapshotTimeUtc: new Date('2026-04-16T12:00:00.000Z'),
      previousSnapshotBlock: '2219319',
      fromBlockInclusive: '2219319',
      toBlockExclusive: '2226520',
      snapshotStateBlock: '2226519',
      totalStakedWeiSsv: '123456789012345678901234567890',
      walletCount: 1
    });
    await writerService.bulkInsertWalletRows(firstRun.id, [
      {
        walletAddress,
        balanceWeiSsv: '1000000000000000000',
        grossClaimableEthWei: '500000000000000000',
        dailyRewardAccrualWei: '1000000000000000',
        claimedInWindowWei: '0',
        burnedDustInWindowWei: '0'
      }
    ]);

    const secondRun = await writerService.insertSnapshotRun({
      snapshotDate: '2026-04-17',
      snapshotTimeUtc: new Date('2026-04-17T12:00:00.000Z'),
      previousSnapshotBlock: '2226520',
      fromBlockInclusive: '2226520',
      toBlockExclusive: '2233720',
      snapshotStateBlock: '2233719',
      totalStakedWeiSsv: '223456789012345678901234567890',
      walletCount: 1
    });
    await writerService.bulkInsertWalletRows(secondRun.id, [
      {
        walletAddress,
        balanceWeiSsv: '2000000000000000000',
        grossClaimableEthWei: '700000000000000000',
        dailyRewardAccrualWei: '2000000000000000',
        claimedInWindowWei: '1000000000000000',
        burnedDustInWindowWei: '1'
      }
    ]);

    await expect(queryService.getLatestSnapshotRun()).resolves.toMatchObject({
      snapshotDate: '2026-04-17'
    });

    await expect(
      queryService.getSnapshotWalletsByRunId(secondRun.id)
    ).resolves.toMatchObject([
      {
        walletAddress: '0x58410Bef803ECd7E63B23664C586A6DB72DAf59c',
        balanceWeiSsv: '2000000000000000000'
      }
    ]);

    await expect(
      queryService.listWalletSnapshots(walletAddress, 10, 0)
    ).resolves.toMatchObject([
      {
        walletAddress: '0x58410Bef803ECd7E63B23664C586A6DB72DAf59c',
        snapshotRun: {
          snapshotDate: '2026-04-17'
        }
      },
      {
        walletAddress: '0x58410Bef803ECd7E63B23664C586A6DB72DAf59c',
        snapshotRun: {
          snapshotDate: '2026-04-16'
        }
      }
    ]);

    await expect(
      writerService.deleteSnapshotDayAndLater('2026-04-17')
    ).resolves.toBe(1);

    await expect(queryService.getLatestSnapshotRun()).resolves.toMatchObject({
      snapshotDate: '2026-04-16'
    });

    const [remainingWallets] = (await dataSource.query(
      'select count(*)::int as count from "cssv_snapshot_wallets"'
    )) as Array<{ count: number }>;

    expect(remainingWallets.count).toBe(1);
  });

  it('blocks concurrent advisory-lock acquisition until the first runner releases', async () => {
    const firstRunner = await lockService.tryAcquire();

    expect(firstRunner).not.toBeNull();

    const secondRunner = await lockService.tryAcquire();

    expect(secondRunner).toBeNull();

    await lockService.release(firstRunner);

    const thirdRunner = await lockService.tryAcquire();

    expect(thirdRunner).not.toBeNull();

    await lockService.release(thirdRunner);
  });
});

async function initializeDataSourceWithRetry(dataSource: DataSource): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await dataSource.initialize();
      return;
    } catch (error) {
      lastError = error;
      // Postgres can announce readiness before its final restart during container init.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  throw lastError;
}
