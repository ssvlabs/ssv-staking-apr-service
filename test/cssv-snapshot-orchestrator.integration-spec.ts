import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo, Socket } from 'node:net';
import { ethers } from 'ethers';
import { DataSource } from 'typeorm';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
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
import { CssvSnapshotAdvisoryLockService } from '../src/cssv-snapshot/services/cssv-snapshot-advisory-lock.service';
import { CssvSnapshotBlockchainService } from '../src/cssv-snapshot/services/cssv-snapshot-blockchain.service';
import { CssvSnapshotBoundaryFinderService } from '../src/cssv-snapshot/services/cssv-snapshot-boundary-finder.service';
import { CssvSnapshotLogReaderService } from '../src/cssv-snapshot/services/cssv-snapshot-log-reader.service';
import { CssvSnapshotOrchestratorService } from '../src/cssv-snapshot/services/cssv-snapshot-orchestrator.service';
import { CssvSnapshotQueryService } from '../src/cssv-snapshot/services/cssv-snapshot-query.service';
import { CssvSnapshotReplayService } from '../src/cssv-snapshot/services/cssv-snapshot-replay.service';
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
  | 'cssvDeploymentBlock'
  | 'expectedBlocksPerDay'
  | 'logChunkSizeBlocks'
  | 'cronExpression'
  | 'cronTimeZone'
>;

const ETHERS_PROVIDER_CACHE_WINDOW_MS = 300;

describe('CSSV snapshot orchestrator integration', () => {
  const viewsAddress = '0x5AdDb3f1529C5ec70D77400499eE4bbF328368fe';
  const stakingAddress = '0x58410Bef803ECd7E63B23664C586A6DB72DAf59c';
  const cssvTokenAddress = '0x6e1a5d27361c666f681af06535c8Ac773E571d4d';
  const userA = ethers.getAddress('0x1111111111111111111111111111111111111111');
  const userB = ethers.getAddress('0x2222222222222222222222222222222222222222');
  const deploymentBlock = 95;
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
  let server: Server;
  let sockets: Set<Socket>;
  let rpcUrl: string;
  let queryService: CssvSnapshotQueryService;
  let writerService: CssvSnapshotWriterService;
  let lockService: CssvSnapshotAdvisoryLockService;
  let blockchainService: CssvSnapshotBlockchainService;
  let orchestratorService: CssvSnapshotOrchestratorService;

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
      cssvDeploymentBlock: deploymentBlock,
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
      writerService
    );
  });

  afterAll(async () => {
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
    await waitForProviderCacheWindow();
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
      totalStakedWeiSsv: '1000',
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
      totalStakedWeiSsv: '1100',
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
      totalStakedWeiSsv: '1200',
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
    chainState.totalStakedByBlock = new Map([[firstSnapshotStateBlock, 1000n]]);
    chainState.previewByBlockAndWallet = new Map([
      [getPreviewKey(firstSnapshotStateBlock, userA), 60n],
      [getPreviewKey(firstSnapshotStateBlock, userB), 5n]
    ]);
  }

  function configureChainStateThroughDayTwo(): void {
    chainState.latestBlockNumber = 206;
    chainState.logs = [...dayOneLogs, ...dayTwoLogs];
    chainState.totalStakedByBlock = new Map([
      [firstSnapshotStateBlock, 1000n],
      [secondSnapshotStateBlock, 1100n]
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
    chainState.totalStakedByBlock = new Map([
      [firstSnapshotStateBlock, 1000n],
      [secondSnapshotStateBlock, 1100n],
      [thirdSnapshotStateBlock, 1200n]
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
  ): Promise<JsonRpcSuccessResponse> {
    const params = input.params ?? [];

    switch (input.method) {
      case 'eth_chainId':
        return success(input.id, toHex(HOODI_CHAIN_ID));
      case 'eth_blockNumber':
        return success(input.id, toHex(chainState.latestBlockNumber));
      case 'eth_getBlockByNumber':
        return success(input.id, getBlockByTag(params[0]));
      case 'eth_getLogs':
        return success(input.id, getLogs(params[0]));
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
    const totalStakedSelector = viewsInterface.getFunction('totalStaked')!.selector;
    const previewSelector =
      viewsInterface.getFunction('previewClaimableEth')!.selector;

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
