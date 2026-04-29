import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { ethers } from 'ethers';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { CssvSnapshotRun, CssvSnapshotWallet } from '../src/entities';
import { CreateCssvSnapshotTables20260417090000 } from '../src/migrations/20260417090000-create-cssv-snapshot-tables';
import { CssvSnapshotController } from '../src/cssv-snapshot/controllers/cssv-snapshot.controller';
import { CssvSnapshotOrchestratorService } from '../src/cssv-snapshot/services/cssv-snapshot-orchestrator.service';
import { CssvSnapshotQueryService } from '../src/cssv-snapshot/services/cssv-snapshot-query.service';
import { CssvSnapshotReadService } from '../src/cssv-snapshot/services/cssv-snapshot-read.service';

describe('CSSV snapshot API integration', () => {
  const ownerAddress = ethers.getAddress(
    '0x1234567890abcdef1234567890abcdef12345678'
  );
  const otherAddress = ethers.getAddress(
    '0x9999999999999999999999999999999999999999'
  );

  let container: StartedTestContainer;
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let snapshotRunRepository: Repository<CssvSnapshotRun>;
  let snapshotWalletRepository: Repository<CssvSnapshotWallet>;
  const orchestratorServiceMock = {
    runLockedRepairFromSnapshotDate: jest.fn()
  };

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_DB: 'ssv_apr_api_test',
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

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: container.getHost(),
          port: container.getMappedPort(5432),
          username: 'ssv_user',
          password: 'ssv_password',
          database: 'ssv_apr_api_test',
          entities: [CssvSnapshotRun, CssvSnapshotWallet],
          migrations: [CreateCssvSnapshotTables20260417090000],
          migrationsRun: true,
          synchronize: false
        }),
        TypeOrmModule.forFeature([CssvSnapshotRun, CssvSnapshotWallet])
      ],
      controllers: [CssvSnapshotController],
      providers: [
        CssvSnapshotQueryService,
        CssvSnapshotReadService,
        {
          provide: CssvSnapshotOrchestratorService,
          useValue: orchestratorServiceMock
        }
      ]
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true
      })
    );
    app.setGlobalPrefix('api');
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    snapshotRunRepository = dataSource.getRepository(CssvSnapshotRun);
    snapshotWalletRepository = dataSource.getRepository(CssvSnapshotWallet);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }

    if (container) {
      await container.stop();
    }
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE "cssv_snapshot_runs" CASCADE');
    jest.clearAllMocks();
  });

  it('returns wallet snapshots with latest snapshot first', async () => {
    await seedSnapshot({
      snapshotDate: '2026-04-17',
      fromBlockInclusive: '95',
      toBlockExclusive: '105',
      snapshotStateBlock: '104',
      ownerBalanceWeiSsv: '40',
      ownerDailyRewardAccrualWei: '100',
      ownerGrossClaimableEthWei: '60',
      ownerClaimedInWindowWei: '40',
      ownerBurnedDustInWindowWei: '0'
    });
    await seedSnapshot({
      snapshotDate: '2026-04-18',
      fromBlockInclusive: '105',
      toBlockExclusive: '205',
      snapshotStateBlock: '204',
      ownerBalanceWeiSsv: '0',
      ownerDailyRewardAccrualWei: '0',
      ownerGrossClaimableEthWei: '0',
      ownerClaimedInWindowWei: '50',
      ownerBurnedDustInWindowWei: '10'
    });

    const response = await request(app.getHttpServer())
      .get(`/api/apr/snapshots/${ownerAddress.toLowerCase()}`)
      .expect(200);

    expect(response.body).toEqual({
      ownerAddress,
      snapshots: [
        {
          snapshotDate: '2026-04-18',
          snapshotTimeUtc: '2026-04-18T12:00:00.000Z',
          fromBlock: 105,
          toBlock: 204,
          balanceWeiSsv: '0',
          dailyRewardAccrualWei: '0',
          grossClaimableEthWei: '0',
          claimedInWindowWei: '50',
          burnedDustInWindowWei: '10'
        },
        {
          snapshotDate: '2026-04-17',
          snapshotTimeUtc: '2026-04-17T12:00:00.000Z',
          fromBlock: 95,
          toBlock: 104,
          balanceWeiSsv: '40',
          dailyRewardAccrualWei: '100',
          grossClaimableEthWei: '60',
          claimedInWindowWei: '40',
          burnedDustInWindowWei: '0'
        }
      ]
    });
  });

  it('supports limit and offset', async () => {
    await seedSnapshot({
      snapshotDate: '2026-04-17',
      fromBlockInclusive: '95',
      toBlockExclusive: '105',
      snapshotStateBlock: '104',
      ownerBalanceWeiSsv: '40',
      ownerDailyRewardAccrualWei: '100',
      ownerGrossClaimableEthWei: '60',
      ownerClaimedInWindowWei: '40',
      ownerBurnedDustInWindowWei: '0'
    });
    await seedSnapshot({
      snapshotDate: '2026-04-18',
      fromBlockInclusive: '105',
      toBlockExclusive: '205',
      snapshotStateBlock: '204',
      ownerBalanceWeiSsv: '0',
      ownerDailyRewardAccrualWei: '0',
      ownerGrossClaimableEthWei: '0',
      ownerClaimedInWindowWei: '50',
      ownerBurnedDustInWindowWei: '10'
    });

    const response = await request(app.getHttpServer())
      .get(`/api/apr/snapshots/${ownerAddress}?limit=1&offset=1`)
      .expect(200);

    expect(response.body).toEqual({
      ownerAddress,
      snapshots: [
        {
          snapshotDate: '2026-04-17',
          snapshotTimeUtc: '2026-04-17T12:00:00.000Z',
          fromBlock: 95,
          toBlock: 104,
          balanceWeiSsv: '40',
          dailyRewardAccrualWei: '100',
          grossClaimableEthWei: '60',
          claimedInWindowWei: '40',
          burnedDustInWindowWei: '0'
        }
      ]
    });
  });

  it('returns an empty snapshot list for a valid wallet with no rows', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/apr/snapshots/${ownerAddress}`)
      .expect(200);

    expect(response.body).toEqual({
      ownerAddress,
      snapshots: []
    });
  });

  it('rejects an invalid wallet address', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/apr/snapshots/not-an-address')
      .expect(400);

    expect(response.body.message).toBe('Invalid owner address');
  });

  it('repairs snapshots from an admin endpoint', async () => {
    orchestratorServiceMock.runLockedRepairFromSnapshotDate.mockResolvedValueOnce({
      deletedRuns: 2,
      createdRuns: 2
    });

    const response = await request(app.getHttpServer())
      .post('/api/apr/admin/snapshots/repair')
      .send({
        snapshotDate: '2026-04-18'
      })
      .expect(200);

    expect(orchestratorServiceMock.runLockedRepairFromSnapshotDate).toHaveBeenCalledWith(
      '2026-04-18'
    );
    expect(response.body).toEqual({
      snapshotDate: '2026-04-18',
      deletedRuns: 2,
      createdRuns: 2
    });
  });

  it('rejects an invalid repair snapshot date', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/apr/admin/snapshots/repair')
      .send({
        snapshotDate: '2026-13-40'
      })
      .expect(400);

    expect(orchestratorServiceMock.runLockedRepairFromSnapshotDate).not.toHaveBeenCalled();
    expect(response.body.message).toContain('Invalid snapshotDate');
  });

  async function seedSnapshot(input: {
    snapshotDate: string;
    fromBlockInclusive: string;
    toBlockExclusive: string;
    snapshotStateBlock: string;
    ownerBalanceWeiSsv: string;
    ownerDailyRewardAccrualWei: string;
    ownerGrossClaimableEthWei: string;
    ownerClaimedInWindowWei: string;
    ownerBurnedDustInWindowWei: string;
  }): Promise<void> {
    const snapshotRun = await snapshotRunRepository.save(
      snapshotRunRepository.create({
        snapshotDate: input.snapshotDate,
        snapshotTimeUtc: new Date(`${input.snapshotDate}T12:00:00.000Z`),
        previousSnapshotBlock: input.fromBlockInclusive,
        fromBlockInclusive: input.fromBlockInclusive,
        toBlockExclusive: input.toBlockExclusive,
        snapshotStateBlock: input.snapshotStateBlock,
        totalStakedWeiSsv: '123',
        walletCount: 2
      })
    );

    await snapshotWalletRepository.save([
      snapshotWalletRepository.create({
        snapshotRunId: snapshotRun.id,
        walletAddress: ownerAddress,
        balanceWeiSsv: input.ownerBalanceWeiSsv,
        dailyRewardAccrualWei: input.ownerDailyRewardAccrualWei,
        grossClaimableEthWei: input.ownerGrossClaimableEthWei,
        claimedInWindowWei: input.ownerClaimedInWindowWei,
        burnedDustInWindowWei: input.ownerBurnedDustInWindowWei
      }),
      snapshotWalletRepository.create({
        snapshotRunId: snapshotRun.id,
        walletAddress: otherAddress,
        balanceWeiSsv: '1',
        dailyRewardAccrualWei: '2',
        grossClaimableEthWei: '3',
        claimedInWindowWei: '4',
        burnedDustInWindowWei: '0'
      })
    ]);
  }
});
