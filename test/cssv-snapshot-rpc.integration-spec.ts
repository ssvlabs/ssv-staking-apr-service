import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo, Socket } from 'node:net';
import { ethers } from 'ethers';
import { CssvSnapshotConfigService } from '../src/cssv-snapshot/config/cssv-snapshot.config';
import { CSSV_TOKEN_MINIMAL_ABI } from '../src/cssv-snapshot/abis/cssv-token.abi';
import { CSSV_SNAPSHOT_STAKING_MINIMAL_ABI } from '../src/cssv-snapshot/abis/ssv-staking.abi';
import { CSSV_SNAPSHOT_VIEWS_MINIMAL_ABI } from '../src/cssv-snapshot/abis/ssv-views.abi';
import { CssvSnapshotBoundaryFinderService } from '../src/cssv-snapshot/services/cssv-snapshot-boundary-finder.service';
import { CssvSnapshotBlockchainService } from '../src/cssv-snapshot/services/cssv-snapshot-blockchain.service';
import { CssvSnapshotLogReaderService } from '../src/cssv-snapshot/services/cssv-snapshot-log-reader.service';
import { CssvSnapshotReplayService } from '../src/cssv-snapshot/services/cssv-snapshot-replay.service';

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

interface RecordedGetLogsRequest {
  address: string;
  fromBlock: number;
  toBlock: number;
  topicHash: string;
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

type MockCssvSnapshotConfig = Pick<
  CssvSnapshotConfigService,
  | 'rpcUrl'
  | 'viewsContractAddress'
  | 'stakingContractAddress'
  | 'cssvTokenAddress'
  | 'cssvDeploymentBlock'
  | 'expectedBlocksPerDay'
  | 'logChunkSizeBlocks'
  | 'cronExpression'
  | 'cronTimeZone'
>;

describe('CSSV snapshot RPC integration', () => {
  const viewsAddress = '0x5AdDb3f1529C5ec70D77400499eE4bbF328368fe';
  const stakingAddress = '0x58410Bef803ECd7E63B23664C586A6DB72DAf59c';
  const cssvTokenAddress = '0x6e1a5d27361c666f681af06535c8Ac773E571d4d';
  const userA = '0x1111111111111111111111111111111111111111';
  const userB = '0x2222222222222222222222222222222222222222';
  const totalStakedAt104 = 123_456_789n;
  const previewClaimableAt104 = 987_654_321n;
  const blocks = new Map<number, MockBlock>([
    [95, { number: 95, timestamp: Math.floor(Date.parse('2026-04-17T10:00:00.000Z') / 1000) }],
    [100, { number: 100, timestamp: Math.floor(Date.parse('2026-04-16T12:00:01.000Z') / 1000) }],
    [104, { number: 104, timestamp: Math.floor(Date.parse('2026-04-17T12:00:00.000Z') / 1000) }],
    [105, { number: 105, timestamp: Math.floor(Date.parse('2026-04-17T12:00:01.000Z') / 1000) }],
    [106, { number: 106, timestamp: Math.floor(Date.parse('2026-04-17T12:00:20.000Z') / 1000) }]
  ]);
  const latestBlockNumber = 106;
  const viewsInterface = new ethers.Interface(CSSV_SNAPSHOT_VIEWS_MINIMAL_ABI);
  const transferInterface = new ethers.Interface(CSSV_TOKEN_MINIMAL_ABI);
  const stakingInterface = new ethers.Interface(CSSV_SNAPSHOT_STAKING_MINIMAL_ABI);
  const transferEvent = getEventOrThrow(transferInterface, 'Transfer');
  const rewardsSettledEvent = getEventOrThrow(
    stakingInterface,
    'RewardsSettled'
  );
  const rewardsClaimedEvent = getEventOrThrow(
    stakingInterface,
    'RewardsClaimed'
  );
  const rpcLogs: RpcLog[] = [
    createTransferLog({
      address: cssvTokenAddress,
      transactionHash:
        '0x00000000000000000000000000000000000000000000000000000000000000aa',
      blockNumber: 100,
      transactionIndex: 2,
      logIndex: 0,
      from: userA,
      to: userB,
      amountWei: 10n
    }),
    createRewardsSettledLog({
      address: stakingAddress,
      transactionHash:
        '0x00000000000000000000000000000000000000000000000000000000000000bb',
      blockNumber: 101,
      transactionIndex: 1,
      logIndex: 0,
      user: userA,
      pendingWei: 5n,
      accruedWei: 50n,
      userIndex: 7n
    }),
    createRewardsClaimedLog({
      address: stakingAddress,
      transactionHash:
        '0x00000000000000000000000000000000000000000000000000000000000000bb',
      blockNumber: 101,
      transactionIndex: 1,
      logIndex: 1,
      user: userA,
      payoutWei: 40n
    }),
    createTransferLog({
      address: cssvTokenAddress,
      transactionHash:
        '0x00000000000000000000000000000000000000000000000000000000000000cc',
      blockNumber: 104,
      transactionIndex: 0,
      logIndex: 2,
      from: userB,
      to: userA,
      amountWei: 20n
    })
  ];
  const getLogsRequests: RecordedGetLogsRequest[] = [];
  const sockets = new Set<Socket>();
  let server: Server;
  let rpcUrl: string;
  let blockchainService: CssvSnapshotBlockchainService;
  let logReaderService: CssvSnapshotLogReaderService;
  let boundaryFinderService: CssvSnapshotBoundaryFinderService;
  let replayService: CssvSnapshotReplayService;

  beforeAll(async () => {
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
      viewsContractAddress: viewsAddress,
      stakingContractAddress: stakingAddress,
      cssvTokenAddress,
      cssvDeploymentBlock: 95,
      expectedBlocksPerDay: 5,
      logChunkSizeBlocks: 2,
      cronExpression: '15 12 * * *',
      cronTimeZone: 'UTC'
    };

    blockchainService = new CssvSnapshotBlockchainService(
      config as CssvSnapshotConfigService
    );
    logReaderService = new CssvSnapshotLogReaderService(
      config as CssvSnapshotConfigService,
      blockchainService
    );
    boundaryFinderService = new CssvSnapshotBoundaryFinderService(
      config as CssvSnapshotConfigService,
      blockchainService
    );
    replayService = new CssvSnapshotReplayService();
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
  });

  beforeEach(() => {
    getLogsRequests.length = 0;
  });

  it('uses a real JsonRpcProvider for block-tagged view reads and half-open log chunking', async () => {
    await expect(blockchainService.totalStakedAtBlock(104)).resolves.toBe(
      totalStakedAt104
    );
    await expect(
      blockchainService.previewClaimableEthAtBlock(userA, 104)
    ).resolves.toBe(previewClaimableAt104);

    const result = await logReaderService.readSnapshotEvents(100, 105);

    expect(result.events.map((event) => event.kind)).toEqual([
      'transfer',
      'rewardsSettled',
      'rewardsClaimed',
      'transfer'
    ]);
    expect(result.pairedClaims).toHaveLength(1);
    expect(result.pairedClaims[0]).toMatchObject({
      transactionHash:
        '0x00000000000000000000000000000000000000000000000000000000000000bb',
      walletAddress: ethers.getAddress(userA)
    });
    expect(getLogsRequests).toEqual(
      expect.arrayContaining([
        {
          address: ethers.getAddress(cssvTokenAddress),
          fromBlock: 100,
          toBlock: 101,
          topicHash: transferEvent.topicHash
        },
        {
          address: ethers.getAddress(cssvTokenAddress),
          fromBlock: 102,
          toBlock: 103,
          topicHash: transferEvent.topicHash
        },
        {
          address: ethers.getAddress(cssvTokenAddress),
          fromBlock: 104,
          toBlock: 104,
          topicHash: transferEvent.topicHash
        }
      ])
    );
  });

  it('finds the next snapshot window through real block-header RPC calls', async () => {
    const previousSnapshotRun = {
      snapshotDate: '2026-04-16',
      toBlockExclusive: '100'
    };

    await expect(
      boundaryFinderService.findNextWindow(previousSnapshotRun as any)
    ).resolves.toEqual({
      snapshotDate: '2026-04-17',
      fromBlockInclusive: 100,
      toBlockExclusive: 105,
      snapshotStateBlock: 104
    });
  });

  it('derives the first eligible snapshot window from deployment block through real RPC calls', async () => {
    await expect(boundaryFinderService.findNextWindow(null)).resolves.toEqual({
      snapshotDate: '2026-04-17',
      fromBlockInclusive: 95,
      toBlockExclusive: 105,
      snapshotStateBlock: 104
    });
  });

  it('replays events into final snapshot rows with exact zero-balance dust accounting', async () => {
    const result = await logReaderService.readSnapshotEvents(100, 105);
    const previousState = [
      {
        walletAddress: userA,
        balanceWeiSsv: 10n,
        previousGrossClaimableWei: 100n
      },
      {
        walletAddress: userB,
        balanceWeiSsv: 10n,
        previousGrossClaimableWei: 0n
      }
    ];
    const walletQuerySet = replayService.buildWalletQuerySet(
      previousState,
      result.events,
      result.pairedClaims
    );
    const walletStateMap = replayService.createWalletStateMap(previousState);

    replayService.applyEvents(walletStateMap, result.events, result.pairedClaims);

    expect(walletStateMap.get(ethers.getAddress(userA))).toMatchObject({
      balanceWeiSsv: 20n,
      previousGrossClaimableWei: 100n,
      claimedInWindowWei: 40n,
      burnedDustInWindowWei: 10n
    });
    expect(walletStateMap.get(ethers.getAddress(userB))).toMatchObject({
      balanceWeiSsv: 0n,
      previousGrossClaimableWei: 0n,
      claimedInWindowWei: 0n,
      burnedDustInWindowWei: 0n
    });

    expect(walletQuerySet).toEqual(
      expect.arrayContaining([
        ethers.getAddress(userA),
        ethers.getAddress(userB)
      ])
    );
    const currentPreviewByWallet =
      await blockchainService.previewClaimableEthBatchAtBlock(walletQuerySet, 104);

    expect(
      replayService.buildSnapshotWalletRows(walletStateMap, currentPreviewByWallet)
    ).toEqual([
      {
        walletAddress: ethers.getAddress(userA),
        balanceWeiSsv: 20n,
        grossClaimableEthWei: previewClaimableAt104,
        dailyRewardAccrualWei: previewClaimableAt104 - 50n,
        claimedInWindowWei: 40n,
        burnedDustInWindowWei: 10n
      }
    ]);
  });

  async function handleRpcRequest(
    input: JsonRpcRequest
  ): Promise<JsonRpcSuccessResponse> {
    const params = input.params ?? [];

    switch (input.method) {
      case 'eth_chainId':
        return success(input.id, toHex(1));
      case 'eth_blockNumber':
        return success(input.id, toHex(latestBlockNumber));
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
      blockTag === 'latest' ? latestBlockNumber : normalizeBlockTag(blockTag);
    const block = blocks.get(blockNumber);

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

    getLogsRequests.push({
      address,
      fromBlock,
      toBlock,
      topicHash
    });

    return rpcLogs.filter(
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
        blockNumber === 104 ? totalStakedAt104 : 0n
      ]);
    }

    if (data.startsWith(previewSelector)) {
      const [walletAddress] = viewsInterface.decodeFunctionData(
        'previewClaimableEth',
        data
      );

      return viewsInterface.encodeFunctionResult('previewClaimableEth', [
        blockNumber === 104 && ethers.getAddress(walletAddress) === ethers.getAddress(userA)
          ? previewClaimableAt104
          : 0n
      ]);
    }

    throw new Error(`Unsupported eth_call data ${data}`);
  }
});

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
    throw new Error('latest block tag should be handled before normalization');
  }

  return Number(BigInt(value));
}

function toHex(value: number): string {
  return `0x${value.toString(16)}`;
}

function toHash(seed: number): string {
  return `0x${seed.toString(16).padStart(64, '0')}`;
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
  const transferInterface = new ethers.Interface(CSSV_TOKEN_MINIMAL_ABI);
  const encoded = transferInterface.encodeEventLog(
    getEventOrThrow(transferInterface, 'Transfer'),
    [input.from, input.to, input.amountWei]
  );

  return createRpcLog({
    address: input.address,
    transactionHash: input.transactionHash,
    blockNumber: input.blockNumber,
    transactionIndex: input.transactionIndex,
    logIndex: input.logIndex,
    topics: encoded.topics,
    data: encoded.data
  });
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
  const stakingInterface = new ethers.Interface(CSSV_SNAPSHOT_STAKING_MINIMAL_ABI);
  const encoded = stakingInterface.encodeEventLog(
    getEventOrThrow(stakingInterface, 'RewardsSettled'),
    [input.user, input.pendingWei, input.accruedWei, input.userIndex]
  );

  return createRpcLog({
    address: input.address,
    transactionHash: input.transactionHash,
    blockNumber: input.blockNumber,
    transactionIndex: input.transactionIndex,
    logIndex: input.logIndex,
    topics: encoded.topics,
    data: encoded.data
  });
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
  const stakingInterface = new ethers.Interface(CSSV_SNAPSHOT_STAKING_MINIMAL_ABI);
  const encoded = stakingInterface.encodeEventLog(
    getEventOrThrow(stakingInterface, 'RewardsClaimed'),
    [input.user, input.payoutWei]
  );

  return createRpcLog({
    address: input.address,
    transactionHash: input.transactionHash,
    blockNumber: input.blockNumber,
    transactionIndex: input.transactionIndex,
    logIndex: input.logIndex,
    topics: encoded.topics,
    data: encoded.data
  });
}

function createRpcLog(input: {
  address: string;
  transactionHash: string;
  blockNumber: number;
  transactionIndex: number;
  logIndex: number;
  topics: string[];
  data: string;
}): RpcLog {
  return {
    address: ethers.getAddress(input.address),
    blockHash: toHash(input.blockNumber),
    blockNumber: toHex(input.blockNumber),
    data: input.data,
    index: toHex(input.logIndex),
    logIndex: toHex(input.logIndex),
    removed: false,
    topics: input.topics,
    transactionHash: input.transactionHash,
    transactionIndex: toHex(input.transactionIndex)
  };
}

function getEventOrThrow(
  eventInterface: ethers.Interface,
  eventName: string
): ethers.EventFragment {
  const event = eventInterface.getEvent(eventName);

  if (!event) {
    throw new Error(`Event ${eventName} not found in test interface`);
  }

  return event;
}
