import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo, Socket } from 'node:net';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ethers } from 'ethers';
import { DataSource } from 'typeorm';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  AprSample,
  CssvSnapshotRun,
  CssvSnapshotWallet
} from '../src/entities';
import { CreateAprSamplesTable20260209133000 } from '../src/migrations/20260209133000-create-apr-samples';
import { CreateCssvSnapshotTables20260417090000 } from '../src/migrations/20260417090000-create-cssv-snapshot-tables';
import { CssvSnapshotConfigService } from '../src/cssv-snapshot/config/cssv-snapshot.config';
import { HOODI_CHAIN_ID } from '../src/cssv-snapshot/constants/cssv-snapshot.constants';
import { CSSV_TOKEN_MINIMAL_ABI } from '../src/cssv-snapshot/abis/cssv-token.abi';
import { CSSV_SNAPSHOT_STAKING_MINIMAL_ABI } from '../src/cssv-snapshot/abis/ssv-staking.abi';
import { CSSV_SNAPSHOT_VIEWS_MINIMAL_ABI } from '../src/cssv-snapshot/abis/ssv-views.abi';
import { CssvSnapshotController } from '../src/cssv-snapshot/controllers/cssv-snapshot.controller';
import { CssvSnapshotAdvisoryLockService } from '../src/cssv-snapshot/services/cssv-snapshot-advisory-lock.service';
import { CssvSnapshotBlockchainService } from '../src/cssv-snapshot/services/cssv-snapshot-blockchain.service';
import { CssvSnapshotBoundaryFinderService } from '../src/cssv-snapshot/services/cssv-snapshot-boundary-finder.service';
import { CssvSnapshotLogReaderService } from '../src/cssv-snapshot/services/cssv-snapshot-log-reader.service';
import { CssvSnapshotOrchestratorService } from '../src/cssv-snapshot/services/cssv-snapshot-orchestrator.service';
import { CssvSnapshotQueryService } from '../src/cssv-snapshot/services/cssv-snapshot-query.service';
import { CssvSnapshotReadService } from '../src/cssv-snapshot/services/cssv-snapshot-read.service';
import { CssvSnapshotReplayService } from '../src/cssv-snapshot/services/cssv-snapshot-replay.service';
import { CssvSnapshotValidatorService } from '../src/cssv-snapshot/services/cssv-snapshot-validator.service';
import { CssvSnapshotWriterService } from '../src/cssv-snapshot/services/cssv-snapshot-writer.service';

const transferInterface = new ethers.Interface(CSSV_TOKEN_MINIMAL_ABI);
const stakingInterface = new ethers.Interface(CSSV_SNAPSHOT_STAKING_MINIMAL_ABI);

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  id: JsonRpcId;
  jsonrpc: '2.0';
  method: string;
  params?: unknown[];
}

interface JsonRpcSuccessResponse {
  id: JsonRpcId;
  jsonrpc: '2.0';
  result: unknown;
}

interface JsonRpcErrorResponse {
  id: JsonRpcId;
  jsonrpc: '2.0';
  error: {
    code: number;
    message: string;
  };
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

interface MockBlock {
  number: number;
  timestamp: number;
}

interface RpcLog {
  address: string;
  blockHash: string;
  blockNumber: string;
  data: string;
  index: string;
  logIndex: string;
  removed: false;
  topics: string[];
  transactionHash: string;
  transactionIndex: string;
}

interface MockChainState {
  latestBlockNumber: number;
  blocks: Map<number, MockBlock>;
  logs: RpcLog[];
  balancesByBlockAndWallet: Map<string, bigint>;
  totalStakedByBlock: Map<number, bigint>;
  previewByBlockAndWallet: Map<string, bigint>;
}

type MockCssvSnapshotConfig = Pick<
  CssvSnapshotConfigService,
  | 'rpcUrl'
  | 'chainId'
  | 'viewsContractAddress'
  | 'stakingContractAddress'
  | 'cssvTokenAddress'
  | 'cssvSnapshotStartBlock'
  | 'expectedBlocksPerDay'
  | 'logChunkSizeBlocks'
  | 'cronExpression'
  | 'cronTimeZone'
>;

const ETHERS_PROVIDER_CACHE_WINDOW_MS = 300;
const orchestratorIntegrationTransientFailures = new Map<string, number>();
const orchestratorIntegrationRequestCounts = new Map<string, number>();

describe('CSSV snapshot orchestrator integration', () => {
  const viewsAddress = '0x5AdDb3f1529C5ec70D77400499eE4bbF328368fe';
  const stakingAddress = '0x58410Bef803ECd7E63B23664C586A6DB72DAf59c';
  const cssvTokenAddress = '0x6e1a5d27361c666f681af06535c8Ac773E571d4d';
  const userA = ethers.getAddress('0x1111111111111111111111111111111111111111');
  const userB = ethers.getAddress('0x2222222222222222222222222222222222222222');
  const snapshotStartBlock = 95;
  const firstSnapshotStateBlock = 104;
  const secondSnapshotStateBlock = 204;
  const thirdSnapshotStateBlock = 304;
  const baseNoonTimestamp = Math.floor(
    Date.parse('2026-04-17T12:00:00.000Z') / 1000
  );
  const blockIntervalSeconds = 864;
  const blocks = buildBlocks({
    startBlock: 0,
    endBlock: 306,
    baseBlock: firstSnapshotStateBlock,
    baseTimestamp: baseNoonTimestamp,
    secondsPerBlock: blockIntervalSeconds
  });
  const viewsInterface = new ethers.Interface(CSSV_SNAPSHOT_VIEWS_MINIMAL_ABI);
  const dayOneLogs: RpcLog[] = [
    createTransferLog({
      address: cssvTokenAddress,
      transactionHash:
        '0x0000000000000000000000000000000000000000000000000000000000000001',
      blockNumber: 96,
      transactionIndex: 0,
      logIndex: 0,
      from: ethers.ZeroAddress,
      to: userA,
      amountWei: 30n
    }),
    createTransferLog({
      address: cssvTokenAddress,
      transactionHash:
        '0x0000000000000000000000000000000000000000000000000000000000000002',
      blockNumber: 98,
      transactionIndex: 0,
      logIndex: 0,
      from: ethers.ZeroAddress,
      to: userB,
      amountWei: 20n
    }),
    createTransferLog({
      address: cssvTokenAddress,
      transactionHash:
        '0x0000000000000000000000000000000000000000000000000000000000000003',
      blockNumber: 100,
      transactionIndex: 0,
      logIndex: 0,
      from: userA,
      to: userB,
      amountWei: 10n
    }),
    createRewardsSettledLog({
      address: stakingAddress,
      transactionHash:
        '0x0000000000000000000000000000000000000000000000000000000000000004',
      blockNumber: 101,
      transactionIndex: 0,
      logIndex: 0,
      user: userA,
      pendingWei: 5n,
      accruedWei: 50n,
      userIndex: 7n
    }),
    createRewardsClaimedLog({
      address: stakingAddress,
      transactionHash:
        '0x0000000000000000000000000000000000000000000000000000000000000004',
      blockNumber: 101,
      transactionIndex: 0,
      logIndex: 1,
      user: userA,
      payoutWei: 40n
    }),
    createTransferLog({
      address: cssvTokenAddress,
      transactionHash:
        '0x0000000000000000000000000000000000000000000000000000000000000005',
      blockNumber: 104,
      transactionIndex: 0,
      logIndex: 0,
      from: userB,
      to: userA,
      amountWei: 20n
    })
  ];
  const dayTwoLogs: RpcLog[] = [
    createTransferLog({
      address: cssvTokenAddress,
      transactionHash:
        '0x0000000000000000000000000000000000000000000000000000000000000006',
      blockNumber: 110,
      transactionIndex: 0,
      logIndex: 0,
      from: userA,
      to: userB,
      amountWei: 40n
    }),
    createRewardsSettledLog({
      address: stakingAddress,
      transactionHash:
        '0x0000000000000000000000000000000000000000000000000000000000000007',
      blockNumber: 111,
      transactionIndex: 0,
      logIndex: 0,
      user: userA,
      pendingWei: 0n,
      accruedWei: 60n,
      userIndex: 8n
    }),
    createRewardsClaimedLog({
      address: stakingAddress,
      transactionHash:
        '0x0000000000000000000000000000000000000000000000000000000000000007',
      blockNumber: 111,
      transactionIndex: 0,
      logIndex: 1,
      user: userA,
      payoutWei: 50n
    })
  ];
  let chainState: MockChainState;
  let container: StartedTestContainer;
  let dataSource: DataSource;
  let app: INestApplication<App>;
  let server: Server;
  let sockets: Set<Socket>;
  let rpcUrl: string;
  let queryService: CssvSnapshotQueryService;
  let writerService: CssvSnapshotWriterService;
  let lockService: CssvSnapshotAdvisoryLockService;
  let blockchainService: CssvSnapshotBlockchainService;
  let validatorService: CssvSnapshotValidatorService;
  let orchestratorService: CssvSnapshotOrchestratorService;
  const orchestratorControllerMock = {
    runLockedRepairFromSnapshotDate: jest.fn()
  };

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

    sockets = new Set<Socket>();
    server = createServer(async (request, response) => {
      try {
        const body = await readJsonBody(request);
        const payload = Array.isArray(body)
          ? await Promise.all(body.map((entry) => handleRpcRequest(entry)))
          : await handleRpcRequest(body);

        response.statusCode = 200;
        response.setHeader('content-type', 'application/json');
        response.setHeader('connection', 'close');
        response.end(JSON.stringify(payload));
      } catch (error) {
        response.statusCode = 500;
        response.setHeader('content-type', 'application/json');
        response.setHeader('connection', 'close');
        response.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32000,
              message:
                error instanceof Error ? error.message : 'Unknown RPC error'
            }
          })
        );
      }
    });
    server.keepAliveTimeout = 1;
    server.headersTimeout = 2_000;
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });

    const addressInfo = server.address() as AddressInfo;
    rpcUrl = `http://127.0.0.1:${addressInfo.port}`;

    const config: MockCssvSnapshotConfig = {
      rpcUrl,
      chainId: HOODI_CHAIN_ID,
      viewsContractAddress: viewsAddress,
      stakingContractAddress: stakingAddress,
      cssvTokenAddress,
      cssvSnapshotStartBlock: snapshotStartBlock,
      expectedBlocksPerDay: 100,
      logChunkSizeBlocks: 50,
      cronExpression: '15 12 * * *',
      cronTimeZone: 'UTC'
    };

    queryService = new CssvSnapshotQueryService(
      dataSource.getRepository(CssvSnapshotRun),
      dataSource.getRepository(CssvSnapshotWallet)
    );
    writerService = new CssvSnapshotWriterService(
      dataSource.getRepository(CssvSnapshotRun),
      dataSource.getRepository(CssvSnapshotWallet)
    );
    lockService = new CssvSnapshotAdvisoryLockService(dataSource);
    blockchainService = new CssvSnapshotBlockchainService(
      config as CssvSnapshotConfigService
    );
    const logReaderService = new CssvSnapshotLogReaderService(
      config as CssvSnapshotConfigService,
      blockchainService
    );
    const replayService = new CssvSnapshotReplayService();
    validatorService = new CssvSnapshotValidatorService(
      queryService,
      blockchainService
    );

    orchestratorService = new CssvSnapshotOrchestratorService(
      config as CssvSnapshotConfigService,
      lockService,
      blockchainService,
      new CssvSnapshotBoundaryFinderService(
        config as CssvSnapshotConfigService,
        blockchainService
      ),
      logReaderService,
      queryService,
      replayService,
      validatorService,
      writerService
    );

    const apiModule: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: container.getHost(),
          port: container.getMappedPort(5432),
          username: 'ssv_user',
          password: 'ssv_password',
          database: 'ssv_apr_test',
          entities: [CssvSnapshotRun, CssvSnapshotWallet],
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
          useValue: orchestratorControllerMock
        }
      ]
    }).compile();

    app = apiModule.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true
      })
    );
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }

    blockchainService.getProvider().destroy();
    await new Promise((resolve) => setImmediate(resolve));

    for (const socket of sockets) {
      socket.destroy();
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }

    if (container) {
      await container.stop();
    }
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE "cssv_snapshot_runs" CASCADE');
    chainState = createChainState(blocks);
    orchestratorIntegrationTransientFailures.clear();
    orchestratorIntegrationRequestCounts.clear();
    await waitForProviderCacheWindow();
  });

  afterEach(async () => {
    await waitForProviderCacheWindow();
    jest.restoreAllMocks();
  });

  it('creates the first snapshot day end-to-end', async () => {
    configureChainStateThroughDayOne();

    await expect(orchestratorService.runLockedBackfill('manual')).resolves.toBe(1);

    const latestRun = await queryService.getLatestSnapshotRun();

    expect(latestRun).toMatchObject({
      snapshotDate: '2026-04-17',
      previousSnapshotBlock: '95',
      fromBlockInclusive: '95',
      toBlockExclusive: '105',
      snapshotStateBlock: '104',
      totalStakedWeiSsv: '50',
      walletCount: 2
    });

    const walletRows = await queryService.getSnapshotWalletsByRunId(latestRun!.id);

    expect(walletRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          walletAddress: userA,
          balanceWeiSsv: '40',
          grossClaimableEthWei: '60',
          dailyRewardAccrualWei: '100',
          claimedInWindowWei: '40',
          burnedDustInWindowWei: '0'
        }),
        expect.objectContaining({
          walletAddress: userB,
          balanceWeiSsv: '10',
          grossClaimableEthWei: '5',
          dailyRewardAccrualWei: '5',
          claimedInWindowWei: '0',
          burnedDustInWindowWei: '0'
        })
      ])
    );
  });

  it('retries a transient eth_getLogs failure and still persists the snapshot', async () => {
    configureChainStateThroughDayOne();
    const failureKey = getLogsFailureKey({
      address: cssvTokenAddress,
      fromBlock: 95,
      toBlock: 104,
      topicHash: transferInterface.getEvent('Transfer')!.topicHash
    });

    orchestratorIntegrationTransientFailures.set(failureKey, 1);

    await expect(orchestratorService.runLockedBackfill('manual')).resolves.toBe(1);

    const latestRun = await queryService.getLatestSnapshotRun();

    expect(latestRun).toMatchObject({
      snapshotDate: '2026-04-17',
      walletCount: 2
    });
    expect(orchestratorIntegrationRequestCounts.get(failureKey)).toBe(2);
  });

  it('keeps deployment-era empty snapshots quiet during validation', async () => {
    configureEmptyChainStateThroughDayOne();
    const validateSpy = jest.spyOn(validatorService, 'validateSnapshot');
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await expect(orchestratorService.runLockedBackfill('manual')).resolves.toBe(1);

    const latestRun = await queryService.getLatestSnapshotRun();
    const walletRows = await queryService.getSnapshotWalletsByRunId(latestRun!.id);

    expect(latestRun).toMatchObject({
      snapshotDate: '2026-04-17',
      totalStakedWeiSsv: '0',
      walletCount: 0
    });
    expect(walletRows).toEqual([]);
    expect(validateSpy).not.toHaveBeenCalled();

    const validationResult = await validatorService.validateSnapshot(latestRun!.id);

    expect(validationResult.warnings).toEqual([]);
    expect(
      warnSpy.mock.calls.some(([message]) =>
        String(message).includes('CSSV snapshot validation')
      )
    ).toBe(false);

    warnSpy.mockRestore();
    validateSpy.mockRestore();
  });

  it('triggers post-commit validation asynchronously after snapshot commit', async () => {
    configureChainStateThroughDayOne();
    const validateSpy = jest
      .spyOn(validatorService, 'validateSnapshot')
      .mockResolvedValueOnce({
        snapshotDate: '2026-04-17',
        snapshotRunId: '1',
        warnings: []
      });

    await orchestratorService.runLockedBackfill('manual');

    const latestRun = await queryService.getLatestSnapshotRun();

    expect(validateSpy).toHaveBeenCalledWith(latestRun!.id);
    validateSpy.mockRestore();
  });

  it('creates the next day from the previous persisted snapshot', async () => {
    configureChainStateThroughDayOne();
    await orchestratorService.runLockedBackfill('manual');

    configureChainStateThroughDayTwo();
    await waitForProviderCacheWindow();

    await expect(orchestratorService.runLockedBackfill('manual')).resolves.toBe(1);

    const latestRun = await queryService.getLatestSnapshotRun();

    expect(latestRun).toMatchObject({
      snapshotDate: '2026-04-18',
      previousSnapshotBlock: '105',
      fromBlockInclusive: '105',
      toBlockExclusive: '205',
      snapshotStateBlock: '204',
      totalStakedWeiSsv: '50',
      walletCount: 2
    });

    const walletRows = await queryService.getSnapshotWalletsByRunId(latestRun!.id);

    expect(walletRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          walletAddress: userA,
          balanceWeiSsv: '0',
          grossClaimableEthWei: '0',
          dailyRewardAccrualWei: '0',
          claimedInWindowWei: '50',
          burnedDustInWindowWei: '10'
        }),
        expect.objectContaining({
          walletAddress: userB,
          balanceWeiSsv: '50',
          grossClaimableEthWei: '12',
          dailyRewardAccrualWei: '7',
          claimedInWindowWei: '0',
          burnedDustInWindowWei: '0'
        })
      ])
    );
  });

  it('serves freshly persisted snapshots through the api read path', async () => {
    configureChainStateThroughDayOne();

    await expect(orchestratorService.runLockedBackfill('manual')).resolves.toBe(1);

    const response = await request(app.getHttpServer())
      .get(`/api/apr/snapshots/${userA.toLowerCase()}`)
      .expect(200);

    expect(response.body).toEqual({
      ownerAddress: userA,
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

  it('backfills multiple days in one locked run', async () => {
    configureChainStateThroughDayThree();

    await expect(orchestratorService.runLockedBackfill('manual')).resolves.toBe(3);

    const latestRun = await queryService.getLatestSnapshotRun();
    const [runCount] = (await dataSource.query(
      'select count(*)::int as count from "cssv_snapshot_runs"'
    )) as Array<{ count: number }>;

    expect(runCount.count).toBe(3);
    expect(latestRun).toMatchObject({
      snapshotDate: '2026-04-19',
      previousSnapshotBlock: '205',
      fromBlockInclusive: '205',
      toBlockExclusive: '305',
      snapshotStateBlock: '304',
      totalStakedWeiSsv: '50',
      walletCount: 2
    });

    const walletRows = await queryService.getSnapshotWalletsByRunId(latestRun!.id);

    expect(walletRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          walletAddress: userA,
          balanceWeiSsv: '0',
          grossClaimableEthWei: '5',
          dailyRewardAccrualWei: '5',
          claimedInWindowWei: '0',
          burnedDustInWindowWei: '0'
        }),
        expect.objectContaining({
          walletAddress: userB,
          balanceWeiSsv: '50',
          grossClaimableEthWei: '20',
          dailyRewardAccrualWei: '8',
          claimedInWindowWei: '0',
          burnedDustInWindowWei: '0'
        })
      ])
    );
  });

  it('repairs from a bad snapshot day by deleting it and rebuilding later days', async () => {
    configureChainStateThroughDayThree();
    await orchestratorService.runLockedBackfill('manual');
    await waitForProviderCacheWindow();

    await expect(
      orchestratorService.runLockedRepairFromSnapshotDate('2026-04-18')
    ).resolves.toEqual({
      deletedRuns: 2,
      createdRuns: 2
    });

    const latestRun = await queryService.getLatestSnapshotRun();
    const [runCount] = (await dataSource.query(
      'select count(*)::int as count from "cssv_snapshot_runs"'
    )) as Array<{ count: number }>;

    expect(runCount.count).toBe(3);
    expect(latestRun).toMatchObject({
      snapshotDate: '2026-04-19'
    });

    const latestWalletRows = await queryService.getSnapshotWalletsByRunId(
      latestRun!.id
    );

    expect(latestWalletRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          walletAddress: userA,
          grossClaimableEthWei: '5'
        }),
        expect.objectContaining({
          walletAddress: userB,
          grossClaimableEthWei: '20'
        })
      ])
    );
  });

  it('emits warn-only validation logs when sampled values mismatch', async () => {
    configureChainStateThroughDayOne();
    await orchestratorService.runLockedBackfill('manual');
    await waitForProviderCacheWindow();

    const latestRun = await queryService.getLatestSnapshotRun();

    chainState.previewByBlockAndWallet.set(
      getPreviewKey(firstSnapshotStateBlock, userA),
      61n
    );
    chainState.balancesByBlockAndWallet.set(
      getPreviewKey(firstSnapshotStateBlock, userB),
      11n
    );
    await waitForProviderCacheWindow();

    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const result = await validatorService.validateSnapshot(latestRun!.id);

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('sampled_preview_mismatch'),
        expect.stringContaining('sampled_balance_mismatch')
      ])
    );
    expect(
      warnSpy.mock.calls.some(([message]) =>
        String(message).includes('repairFromSnapshotDate=2026-04-17')
      )
    ).toBe(true);

    warnSpy.mockRestore();
  });

  it('rolls back a failed write and recovers cleanly on the next rerun', async () => {
    configureChainStateThroughDayOne();
    await orchestratorService.runLockedBackfill('manual');

    configureChainStateThroughDayTwo();
    await waitForProviderCacheWindow();

    const bulkInsertSpy = jest
      .spyOn(writerService, 'bulkInsertWalletRows')
      .mockRejectedValueOnce(new Error('forced bulk insert failure'));

    await expect(orchestratorService.runLockedBackfill('manual')).rejects.toThrow(
      'forced bulk insert failure'
    );

    const latestRunAfterFailure = await queryService.getLatestSnapshotRun();
    const [runCountAfterFailure] = (await dataSource.query(
      'select count(*)::int as count from "cssv_snapshot_runs"'
    )) as Array<{ count: number }>;

    expect(latestRunAfterFailure).toMatchObject({
      snapshotDate: '2026-04-17'
    });
    expect(runCountAfterFailure.count).toBe(1);

    bulkInsertSpy.mockRestore();
    await waitForProviderCacheWindow();

    await expect(orchestratorService.runLockedBackfill('manual')).resolves.toBe(1);

    const latestRunAfterRecovery = await queryService.getLatestSnapshotRun();
    const [runCountAfterRecovery] = (await dataSource.query(
      'select count(*)::int as count from "cssv_snapshot_runs"'
    )) as Array<{ count: number }>;

    expect(latestRunAfterRecovery).toMatchObject({
      snapshotDate: '2026-04-18'
    });
    expect(runCountAfterRecovery.count).toBe(2);
  });

  it('releases the advisory lock after a failed snapshot run', async () => {
    configureChainStateThroughDayOne();
    await orchestratorService.runLockedBackfill('manual');

    configureChainStateThroughDayTwo();
    await waitForProviderCacheWindow();

    const bulkInsertSpy = jest
      .spyOn(writerService, 'bulkInsertWalletRows')
      .mockRejectedValueOnce(new Error('forced bulk insert failure'));

    await expect(orchestratorService.runLockedBackfill('manual')).rejects.toThrow(
      'forced bulk insert failure'
    );

    const lockRunner = await lockService.tryAcquire();

    expect(lockRunner).not.toBeNull();

    if (!lockRunner) {
      throw new Error('Expected advisory lock to be released after failed run');
    }

    await lockService.release(lockRunner);
    bulkInsertSpy.mockRestore();
  });

  it('skips execution when the advisory lock is already held', async () => {
    configureChainStateThroughDayOne();
    const heldRunner = await lockService.tryAcquire();

    expect(heldRunner).not.toBeNull();

    await expect(orchestratorService.runLockedBackfill('manual')).resolves.toBe(0);
    await expect(queryService.getLatestSnapshotRun()).resolves.toBeNull();

    await lockService.release(heldRunner);
  });

  function configureChainStateThroughDayOne(): void {
    chainState.latestBlockNumber = 106;
    chainState.logs = [...dayOneLogs];
    chainState.balancesByBlockAndWallet = new Map([
      [getPreviewKey(firstSnapshotStateBlock, userA), 40n],
      [getPreviewKey(firstSnapshotStateBlock, userB), 10n]
    ]);
    chainState.totalStakedByBlock = new Map([[firstSnapshotStateBlock, 50n]]);
    chainState.previewByBlockAndWallet = new Map([
      [getPreviewKey(firstSnapshotStateBlock, userA), 60n],
      [getPreviewKey(firstSnapshotStateBlock, userB), 5n]
    ]);
  }

  function configureEmptyChainStateThroughDayOne(): void {
    chainState.latestBlockNumber = 106;
    chainState.logs = [];
    chainState.balancesByBlockAndWallet = new Map();
    chainState.totalStakedByBlock = new Map([[firstSnapshotStateBlock, 0n]]);
    chainState.previewByBlockAndWallet = new Map();
  }

  function configureChainStateThroughDayTwo(): void {
    chainState.latestBlockNumber = 206;
    chainState.logs = [...dayOneLogs, ...dayTwoLogs];
    chainState.balancesByBlockAndWallet = new Map([
      [getPreviewKey(firstSnapshotStateBlock, userA), 40n],
      [getPreviewKey(firstSnapshotStateBlock, userB), 10n],
      [getPreviewKey(secondSnapshotStateBlock, userA), 0n],
      [getPreviewKey(secondSnapshotStateBlock, userB), 50n]
    ]);
    chainState.totalStakedByBlock = new Map([
      [firstSnapshotStateBlock, 50n],
      [secondSnapshotStateBlock, 50n]
    ]);
    chainState.previewByBlockAndWallet = new Map([
      [getPreviewKey(firstSnapshotStateBlock, userA), 60n],
      [getPreviewKey(firstSnapshotStateBlock, userB), 5n],
      [getPreviewKey(secondSnapshotStateBlock, userA), 0n],
      [getPreviewKey(secondSnapshotStateBlock, userB), 12n]
    ]);
  }

  function configureChainStateThroughDayThree(): void {
    chainState.latestBlockNumber = 306;
    chainState.logs = [...dayOneLogs, ...dayTwoLogs];
    chainState.balancesByBlockAndWallet = new Map([
      [getPreviewKey(firstSnapshotStateBlock, userA), 40n],
      [getPreviewKey(firstSnapshotStateBlock, userB), 10n],
      [getPreviewKey(secondSnapshotStateBlock, userA), 0n],
      [getPreviewKey(secondSnapshotStateBlock, userB), 50n],
      [getPreviewKey(thirdSnapshotStateBlock, userA), 0n],
      [getPreviewKey(thirdSnapshotStateBlock, userB), 50n]
    ]);
    chainState.totalStakedByBlock = new Map([
      [firstSnapshotStateBlock, 50n],
      [secondSnapshotStateBlock, 50n],
      [thirdSnapshotStateBlock, 50n]
    ]);
    chainState.previewByBlockAndWallet = new Map([
      [getPreviewKey(firstSnapshotStateBlock, userA), 60n],
      [getPreviewKey(firstSnapshotStateBlock, userB), 5n],
      [getPreviewKey(secondSnapshotStateBlock, userA), 0n],
      [getPreviewKey(secondSnapshotStateBlock, userB), 12n],
      [getPreviewKey(thirdSnapshotStateBlock, userA), 5n],
      [getPreviewKey(thirdSnapshotStateBlock, userB), 20n]
    ]);
  }

  async function handleRpcRequest(
    input: JsonRpcRequest
  ): Promise<JsonRpcResponse> {
    const params = input.params ?? [];

    switch (input.method) {
      case 'eth_chainId':
        return success(input.id, toHex(HOODI_CHAIN_ID));
      case 'eth_blockNumber':
        return success(input.id, toHex(chainState.latestBlockNumber));
      case 'eth_getBlockByNumber':
        return success(input.id, getBlockByTag(params[0]));
      case 'eth_getLogs': {
        const logs = getLogs(params[0]);
        const failureKey = getLogsFailureKey(getLastLogsRequest(params[0]));

        if (consumeTransientFailure(failureKey)) {
          return error(input.id, -32005, 'Too Many Requests');
        }

        return success(input.id, logs);
      }
      case 'eth_call':
        return success(input.id, handleEthCall(params));
      default:
        throw new Error(`Unsupported RPC method ${input.method}`);
    }
  }

  function getBlockByTag(blockTag: unknown): Record<string, unknown> | null {
    const blockNumber =
      blockTag === 'latest'
        ? chainState.latestBlockNumber
        : normalizeBlockTag(blockTag);

    if (blockNumber > chainState.latestBlockNumber) {
      return null;
    }

    const block = chainState.blocks.get(blockNumber);

    if (!block) {
      return null;
    }

    return {
      number: toHex(block.number),
      hash: toHash(block.number),
      parentHash: toHash(Math.max(0, block.number - 1)),
      nonce: '0x0000000000000000',
      sha3Uncles:
        '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
      logsBloom: `0x${'0'.repeat(512)}`,
      transactionsRoot:
        '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
      stateRoot:
        '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
      receiptsRoot:
        '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
      miner: ethers.ZeroAddress,
      difficulty: '0x0',
      totalDifficulty: '0x0',
      extraData: '0x',
      size: '0x1',
      gasLimit: '0x1c9c380',
      gasUsed: '0x0',
      timestamp: toHex(block.timestamp),
      transactions: [],
      uncles: [],
      baseFeePerGas: '0x0'
    };
  }

  function getLogs(filter: unknown): RpcLog[] {
    const parsedFilter = filter as {
      address?: string;
      fromBlock?: string;
      toBlock?: string;
      topics?: Array<string | null>;
    };
    const address = ethers.getAddress(parsedFilter.address ?? ethers.ZeroAddress);
    const fromBlock = normalizeBlockTag(parsedFilter.fromBlock);
    const toBlock = normalizeBlockTag(parsedFilter.toBlock);
    const topicHash = parsedFilter.topics?.[0] ?? '';

    recordRpcRequest(
      getLogsFailureKey({
        address,
        fromBlock,
        toBlock,
        topicHash
      })
    );

    return chainState.logs.filter(
      (log) =>
        ethers.getAddress(log.address) === address &&
        log.topics[0] === topicHash &&
        Number(log.blockNumber) >= fromBlock &&
        Number(log.blockNumber) <= toBlock
    );
  }

  function handleEthCall(params: unknown[]): string {
    const transaction = params[0] as { data?: string; blockTag?: string | number };
    const data = transaction.data ?? '';
    const blockNumber = normalizeBlockTag(params[1] ?? transaction.blockTag);
    const balanceSelector = transferInterface.getFunction('balanceOf')!.selector;
    const totalStakedSelector = viewsInterface.getFunction('totalStaked')!.selector;
    const previewSelector =
      viewsInterface.getFunction('previewClaimableEth')!.selector;

    if (data.startsWith(balanceSelector)) {
      const [walletAddress] = transferInterface.decodeFunctionData(
        'balanceOf',
        data
      );

      return transferInterface.encodeFunctionResult('balanceOf', [
        chainState.balancesByBlockAndWallet.get(
          getPreviewKey(blockNumber, walletAddress)
        ) ?? 0n
      ]);
    }

    if (data.startsWith(totalStakedSelector)) {
      return viewsInterface.encodeFunctionResult('totalStaked', [
        chainState.totalStakedByBlock.get(blockNumber) ?? 0n
      ]);
    }

    if (data.startsWith(previewSelector)) {
      const [walletAddress] = viewsInterface.decodeFunctionData(
        'previewClaimableEth',
        data
      );

      return viewsInterface.encodeFunctionResult('previewClaimableEth', [
        chainState.previewByBlockAndWallet.get(
          getPreviewKey(blockNumber, walletAddress)
        ) ?? 0n
      ]);
    }

    throw new Error(`Unsupported eth_call data ${data}`);
  }
});

function createChainState(blocks: Map<number, MockBlock>): MockChainState {
  return {
    latestBlockNumber: 0,
    blocks,
    logs: [],
    balancesByBlockAndWallet: new Map(),
    totalStakedByBlock: new Map(),
    previewByBlockAndWallet: new Map()
  };
}

function buildBlocks(input: {
  startBlock: number;
  endBlock: number;
  baseBlock: number;
  baseTimestamp: number;
  secondsPerBlock: number;
}): Map<number, MockBlock> {
  const result = new Map<number, MockBlock>();

  for (let blockNumber = input.startBlock; blockNumber <= input.endBlock; blockNumber += 1) {
    result.set(blockNumber, {
      number: blockNumber,
      timestamp:
        input.baseTimestamp +
        (blockNumber - input.baseBlock) * input.secondsPerBlock
    });
  }

  return result;
}

function getPreviewKey(blockNumber: number, walletAddress: string): string {
  return `${blockNumber}:${ethers.getAddress(walletAddress)}`;
}

async function waitForProviderCacheWindow(): Promise<void> {
  await new Promise((resolve) =>
    setTimeout(resolve, ETHERS_PROVIDER_CACHE_WINDOW_MS)
  );
}

async function initializeDataSourceWithRetry(dataSource: DataSource): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await dataSource.initialize();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  throw lastError;
}

async function readJsonBody(request: IncomingMessage): Promise<JsonRpcRequest | JsonRpcRequest[]> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as
    | JsonRpcRequest
    | JsonRpcRequest[];
}

function success(id: JsonRpcId, result: unknown): JsonRpcSuccessResponse {
  return {
    id,
    jsonrpc: '2.0',
    result
  };
}

function error(
  id: JsonRpcId,
  code: number,
  message: string
): JsonRpcErrorResponse {
  return {
    id,
    jsonrpc: '2.0',
    error: {
      code,
      message
    }
  };
}

function recordRpcRequest(key: string): void {
  orchestratorIntegrationRequestCounts.set(
    key,
    (orchestratorIntegrationRequestCounts.get(key) ?? 0) + 1
  );
}

function consumeTransientFailure(key: string): boolean {
  const remainingFailures = orchestratorIntegrationTransientFailures.get(key) ?? 0;

  if (remainingFailures <= 0) {
    return false;
  }

  if (remainingFailures === 1) {
    orchestratorIntegrationTransientFailures.delete(key);
    return true;
  }

  orchestratorIntegrationTransientFailures.set(key, remainingFailures - 1);
  return true;
}

function getLastLogsRequest(filter: unknown): {
  address: string;
  fromBlock: number;
  toBlock: number;
  topicHash: string;
} {
  const parsedFilter = filter as {
    address?: string;
    fromBlock?: string;
    toBlock?: string;
    topics?: Array<string | null>;
  };

  return {
    address: ethers.getAddress(parsedFilter.address ?? ethers.ZeroAddress),
    fromBlock: normalizeBlockTag(parsedFilter.fromBlock),
    toBlock: normalizeBlockTag(parsedFilter.toBlock),
    topicHash: parsedFilter.topics?.[0] ?? ''
  };
}

function getLogsFailureKey(input: {
  address: string;
  fromBlock: number;
  toBlock: number;
  topicHash: string;
}): string {
  return [
    'logs',
    ethers.getAddress(input.address),
    input.fromBlock,
    input.toBlock,
    input.topicHash
  ].join(':');
}

function normalizeBlockTag(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Unsupported block tag ${String(value)}`);
  }

  if (value === 'latest') {
    throw new Error('latest should be handled before normalizeBlockTag');
  }

  return Number(BigInt(value));
}

function toHex(value: number | bigint): string {
  return `0x${BigInt(value).toString(16)}`;
}

function toHash(value: number): string {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

function createTransferLog(input: {
  address: string;
  transactionHash: string;
  blockNumber: number;
  transactionIndex: number;
  logIndex: number;
  from: string;
  to: string;
  amountWei: bigint;
}): RpcLog {
  const event = transferInterface.getEvent('Transfer');

  if (!event) {
    throw new Error('Transfer event not found');
  }

  const encoded = transferInterface.encodeEventLog(event, [
    input.from,
    input.to,
    input.amountWei
  ]);

  return createRpcLog(input, encoded.data, encoded.topics);
}

function createRewardsSettledLog(input: {
  address: string;
  transactionHash: string;
  blockNumber: number;
  transactionIndex: number;
  logIndex: number;
  user: string;
  pendingWei: bigint;
  accruedWei: bigint;
  userIndex: bigint;
}): RpcLog {
  const event = stakingInterface.getEvent('RewardsSettled');

  if (!event) {
    throw new Error('RewardsSettled event not found');
  }

  const encoded = stakingInterface.encodeEventLog(event, [
    input.user,
    input.pendingWei,
    input.accruedWei,
    input.userIndex
  ]);

  return createRpcLog(input, encoded.data, encoded.topics);
}

function createRewardsClaimedLog(input: {
  address: string;
  transactionHash: string;
  blockNumber: number;
  transactionIndex: number;
  logIndex: number;
  user: string;
  payoutWei: bigint;
}): RpcLog {
  const event = stakingInterface.getEvent('RewardsClaimed');

  if (!event) {
    throw new Error('RewardsClaimed event not found');
  }

  const encoded = stakingInterface.encodeEventLog(event, [
    input.user,
    input.payoutWei
  ]);

  return createRpcLog(input, encoded.data, encoded.topics);
}

function createRpcLog(
  input: {
    address: string;
    transactionHash: string;
    blockNumber: number;
    transactionIndex: number;
    logIndex: number;
  },
  data: string,
  topics: string[]
): RpcLog {
  return {
    address: ethers.getAddress(input.address),
    transactionHash: input.transactionHash,
    blockHash: toHash(input.blockNumber),
    blockNumber: toHex(input.blockNumber),
    data,
    topics,
    index: toHex(input.logIndex),
    logIndex: toHex(input.logIndex),
    removed: false,
    transactionIndex: toHex(input.transactionIndex)
  };
}
