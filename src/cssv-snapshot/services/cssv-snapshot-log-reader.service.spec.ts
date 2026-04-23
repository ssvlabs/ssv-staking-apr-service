import { ethers } from 'ethers';
import { CSSV_TOKEN_MINIMAL_ABI } from '../abis/cssv-token.abi';
import { CSSV_SNAPSHOT_STAKING_MINIMAL_ABI } from '../abis/ssv-staking.abi';
import { CssvSnapshotLogReaderService } from './cssv-snapshot-log-reader.service';

describe('CssvSnapshotLogReaderService', () => {
  const cssvTokenAddress = '0x6e1a5d27361c666f681af06535c8Ac773E571d4d';
  const stakingContractAddress =
    '0x58410Bef803ECd7E63B23664C586A6DB72DAf59c';
  const userA = '0x1111111111111111111111111111111111111111';
  const userB = '0x2222222222222222222222222222222222222222';
  const provider = {
    getLogs: jest.fn()
  };
  const blockchainService = {
    getProvider: jest.fn(() => provider),
    runRpcRequestWithRetry: jest.fn(
      async (_description: string, operation: () => Promise<unknown>) => operation()
    )
  };
  const configService = {
    cssvTokenAddress,
    stakingContractAddress,
    logChunkSizeBlocks: 2
  };
  const service = new CssvSnapshotLogReaderService(
    configService as any,
    blockchainService as any
  );
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

  beforeEach(() => {
    provider.getLogs.mockReset();
    blockchainService.runRpcRequestWithRetry.mockClear();
  });

  it('reads chunked logs and globally sorts mixed event types by block, tx index, and log index', async () => {
    provider.getLogs.mockImplementation(async (filter: ethers.Filter) => {
      const address = filter.address as string;
      const fromBlock = Number(filter.fromBlock);
      const toBlock = Number(filter.toBlock);
      const topicHash = filter.topics?.[0] as string;

      if (
        address === cssvTokenAddress &&
        topicHash === transferEvent.topicHash &&
        fromBlock === 100 &&
        toBlock === 101
      ) {
        return [
          createTransferLog({
            address,
            transactionHash:
              '0x00000000000000000000000000000000000000000000000000000000000000aa',
            blockNumber: 100,
            transactionIndex: 2,
            logIndex: 0,
            from: userA,
            to: userB,
            amountWei: 10n
          })
        ];
      }

      if (
        address === stakingContractAddress &&
        topicHash === rewardsSettledEvent.topicHash &&
        fromBlock === 100 &&
        toBlock === 101
      ) {
        return [
          createRewardsSettledLog({
            address,
            transactionHash:
              '0x00000000000000000000000000000000000000000000000000000000000000bb',
            blockNumber: 101,
            transactionIndex: 1,
            logIndex: 0,
            user: userA,
            pendingWei: 5n,
            accruedWei: 50n,
            userIndex: 7n
          })
        ];
      }

      if (
        address === stakingContractAddress &&
        topicHash === rewardsClaimedEvent.topicHash &&
        fromBlock === 100 &&
        toBlock === 101
      ) {
        return [
          createRewardsClaimedLog({
            address,
            transactionHash:
              '0x00000000000000000000000000000000000000000000000000000000000000bb',
            blockNumber: 101,
            transactionIndex: 1,
            logIndex: 1,
            user: userA,
            payoutWei: 40n
          })
        ];
      }

      if (
        address === cssvTokenAddress &&
        topicHash === transferEvent.topicHash &&
        fromBlock === 104 &&
        toBlock === 104
      ) {
        return [
          createTransferLog({
            address,
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
      }

      return [];
    });

    const result = await service.readSnapshotEvents(100, 105);

    expect(provider.getLogs).toHaveBeenCalledTimes(9);
    expect(result.events.map((event) => event.kind)).toEqual([
      'transfer',
      'rewardsSettled',
      'rewardsClaimed',
      'transfer'
    ]);
    expect(result.events.map((event) => event.transactionHash)).toEqual([
      '0x00000000000000000000000000000000000000000000000000000000000000aa',
      '0x00000000000000000000000000000000000000000000000000000000000000bb',
      '0x00000000000000000000000000000000000000000000000000000000000000bb',
      '0x00000000000000000000000000000000000000000000000000000000000000cc'
    ]);
  });

  it('pairs RewardsSettled and RewardsClaimed only when tx hash and user both match', async () => {
    provider.getLogs.mockImplementation(async (filter: ethers.Filter) => {
      const address = filter.address as string;
      const topicHash = filter.topics?.[0] as string;

      if (
        address === stakingContractAddress &&
        topicHash === rewardsSettledEvent.topicHash
      ) {
        return [
          createRewardsSettledLog({
            address,
            transactionHash:
              '0x0000000000000000000000000000000000000000000000000000000000000101',
            blockNumber: 200,
            transactionIndex: 0,
            logIndex: 0,
            user: userA,
            pendingWei: 1n,
            accruedWei: 11n,
            userIndex: 2n
          }),
          createRewardsSettledLog({
            address,
            transactionHash:
              '0x0000000000000000000000000000000000000000000000000000000000000102',
            blockNumber: 201,
            transactionIndex: 0,
            logIndex: 0,
            user: userB,
            pendingWei: 2n,
            accruedWei: 22n,
            userIndex: 3n
          })
        ];
      }

      if (
        address === stakingContractAddress &&
        topicHash === rewardsClaimedEvent.topicHash
      ) {
        return [
          createRewardsClaimedLog({
            address,
            transactionHash:
              '0x0000000000000000000000000000000000000000000000000000000000000101',
            blockNumber: 200,
            transactionIndex: 0,
            logIndex: 1,
            user: userA,
            payoutWei: 10n
          })
        ];
      }

      return [];
    });

    const result = await service.readSnapshotEvents(200, 202);

    expect(
      result.events.filter((event) => event.kind === 'rewardsSettled')
    ).toHaveLength(2);
    expect(
      result.events.filter((event) => event.kind === 'rewardsClaimed')
    ).toHaveLength(1);
    expect(result.pairedClaims).toEqual([
      expect.objectContaining({
        transactionHash:
          '0x0000000000000000000000000000000000000000000000000000000000000101',
        walletAddress: ethers.getAddress(userA),
        rewardsSettled: expect.objectContaining({
          walletAddress: ethers.getAddress(userA),
          accruedWei: 11n
        }),
        rewardsClaimed: expect.objectContaining({
          walletAddress: ethers.getAddress(userA),
          payoutWei: 10n
        })
      })
    ]);
  });

  it('retries only the failed log chunk request', async () => {
    let transferAttempts = 0;

    blockchainService.runRpcRequestWithRetry.mockImplementation(
      async (_description: string, operation: () => Promise<unknown>) => {
        let retryCount = 0;

        while (true) {
          try {
            return await operation();
          } catch (error) {
            if (
              retryCount >= 1 ||
              !String(error).includes('Too Many Requests')
            ) {
              throw error;
            }

            retryCount += 1;
          }
        }
      }
    );

    provider.getLogs.mockImplementation(async (filter: ethers.Filter) => {
      const address = filter.address as string;
      const topicHash = filter.topics?.[0] as string;

      if (
        address === cssvTokenAddress &&
        topicHash === transferEvent.topicHash
      ) {
        transferAttempts += 1;

        if (transferAttempts === 1) {
          throw new Error('Too Many Requests');
        }

        return [
          createTransferLog({
            address,
            transactionHash:
              '0x0000000000000000000000000000000000000000000000000000000000000abc',
            blockNumber: 300,
            transactionIndex: 0,
            logIndex: 0,
            from: userA,
            to: userB,
            amountWei: 7n
          })
        ];
      }

      return [];
    });

    const result = await service.readSnapshotEvents(300, 302);

    const callsByTopic = provider.getLogs.mock.calls.reduce(
      (counts: Record<string, number>, [filter]: [ethers.Filter]) => {
        const topicHash = filter.topics?.[0] as string;

        counts[topicHash] = (counts[topicHash] ?? 0) + 1;
        return counts;
      },
      {}
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      kind: 'transfer',
      blockNumber: 300
    });
    expect(callsByTopic[transferEvent.topicHash]).toBe(2);
    expect(callsByTopic[rewardsSettledEvent.topicHash]).toBe(1);
    expect(callsByTopic[rewardsClaimedEvent.topicHash]).toBe(1);
  });
});

function createTransferLog(input: {
  address: string;
  transactionHash: string;
  blockNumber: number;
  transactionIndex: number;
  logIndex: number;
  from: string;
  to: string;
  amountWei: bigint;
}): ethers.Log {
  const transferInterface = new ethers.Interface(CSSV_TOKEN_MINIMAL_ABI);
  const encoded = transferInterface.encodeEventLog(
    getEventOrThrow(transferInterface, 'Transfer'),
    [input.from, input.to, input.amountWei]
  );

  return createLog({
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
}): ethers.Log {
  const stakingInterface = new ethers.Interface(CSSV_SNAPSHOT_STAKING_MINIMAL_ABI);
  const encoded = stakingInterface.encodeEventLog(
    getEventOrThrow(stakingInterface, 'RewardsSettled'),
    [input.user, input.pendingWei, input.accruedWei, input.userIndex]
  );

  return createLog({
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
}): ethers.Log {
  const stakingInterface = new ethers.Interface(CSSV_SNAPSHOT_STAKING_MINIMAL_ABI);
  const encoded = stakingInterface.encodeEventLog(
    getEventOrThrow(stakingInterface, 'RewardsClaimed'),
    [input.user, input.payoutWei]
  );

  return createLog({
    address: input.address,
    transactionHash: input.transactionHash,
    blockNumber: input.blockNumber,
    transactionIndex: input.transactionIndex,
    logIndex: input.logIndex,
    topics: encoded.topics,
    data: encoded.data
  });
}

function createLog(input: {
  address: string;
  transactionHash: string;
  blockNumber: number;
  transactionIndex: number;
  logIndex: number;
  topics: string[];
  data: string;
}): ethers.Log {
  return {
    address: input.address,
    transactionHash: input.transactionHash,
    blockHash:
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    blockNumber: input.blockNumber,
    removed: false,
    data: input.data,
    topics: input.topics,
    index: input.logIndex,
    transactionIndex: input.transactionIndex
  } as unknown as ethers.Log;
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
