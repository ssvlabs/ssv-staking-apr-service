import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { CSSV_TOKEN_MINIMAL_ABI } from '../abis/cssv-token.abi';
import { CSSV_SNAPSHOT_STAKING_MINIMAL_ABI } from '../abis/ssv-staking.abi';
import { CssvSnapshotConfigService } from '../config/cssv-snapshot.config';
import {
  CssvClaimEventPair,
  CssvRewardsClaimedEvent,
  CssvRewardsSettledEvent,
  CssvSnapshotEvent,
  CssvSnapshotEventReadResult,
  CssvTransferEvent
} from '../types/cssv-snapshot.types';
import { CssvSnapshotBlockchainService } from './cssv-snapshot-blockchain.service';

@Injectable()
export class CssvSnapshotLogReaderService {
  private readonly logger = new Logger(CssvSnapshotLogReaderService.name);
  readonly cssvTransferInterface = new ethers.Interface(CSSV_TOKEN_MINIMAL_ABI);
  readonly stakingInterface = new ethers.Interface(
    CSSV_SNAPSHOT_STAKING_MINIMAL_ABI
  );

  constructor(
    private readonly config: CssvSnapshotConfigService,
    private readonly blockchainService: CssvSnapshotBlockchainService
  ) {}

  getProvider(): ethers.JsonRpcProvider {
    return this.blockchainService.getProvider();
  }

  async readSnapshotEvents(
    fromBlockInclusive: number,
    toBlockExclusive: number
  ): Promise<CssvSnapshotEventReadResult> {
    if (fromBlockInclusive >= toBlockExclusive) {
      this.logger.warn(
        `Skipping CSSV snapshot log read for empty or invalid window [` +
          `${fromBlockInclusive}, ${toBlockExclusive})`
      );

      return {
        events: [],
        pairedClaims: []
      };
    }

    const [transfers, rewardsSettled, rewardsClaimed] = await Promise.all([
      this.readTransfers(fromBlockInclusive, toBlockExclusive),
      this.readRewardsSettled(fromBlockInclusive, toBlockExclusive),
      this.readRewardsClaimed(fromBlockInclusive, toBlockExclusive)
    ]);
    const events = [...transfers, ...rewardsSettled, ...rewardsClaimed].sort(
      this.compareEvents
    );

    return {
      events,
      pairedClaims: this.groupPairedClaimEvents(rewardsSettled, rewardsClaimed)
    };
  }

  groupPairedClaimEvents(
    rewardsSettled: CssvRewardsSettledEvent[],
    rewardsClaimed: CssvRewardsClaimedEvent[]
  ): CssvClaimEventPair[] {
    // Only same-tx, same-user settle+claim flows are relevant for v1 dust accounting.
    const pairMap = new Map<
      string,
      {
        rewardsSettled?: CssvRewardsSettledEvent;
        rewardsClaimed?: CssvRewardsClaimedEvent;
      }
    >();

    for (const event of rewardsSettled) {
      const key = this.getClaimPairKey(event.transactionHash, event.walletAddress);
      const current = pairMap.get(key) ?? {};
      current.rewardsSettled = event;
      pairMap.set(key, current);
    }

    for (const event of rewardsClaimed) {
      const key = this.getClaimPairKey(event.transactionHash, event.walletAddress);
      const current = pairMap.get(key) ?? {};
      current.rewardsClaimed = event;
      pairMap.set(key, current);
    }

    return [...pairMap.entries()]
      .filter(
        (
          entry
        ): entry is [
          string,
          {
            rewardsSettled: CssvRewardsSettledEvent;
            rewardsClaimed: CssvRewardsClaimedEvent;
          }
        ] => Boolean(entry[1].rewardsSettled && entry[1].rewardsClaimed)
      )
      .map(([, pair]) => ({
        transactionHash: pair.rewardsClaimed.transactionHash,
        walletAddress: pair.rewardsClaimed.walletAddress,
        rewardsSettled: pair.rewardsSettled,
        rewardsClaimed: pair.rewardsClaimed
      }))
      .sort((left, right) =>
        this.compareEvents(left.rewardsClaimed, right.rewardsClaimed)
      );
  }

  private async readTransfers(
    fromBlockInclusive: number,
    toBlockExclusive: number
  ): Promise<CssvTransferEvent[]> {
    const eventName = 'Transfer';
    const logs = await this.readChunkedLogs(
      this.config.cssvTokenAddress,
      this.getEventTopicHash(this.cssvTransferInterface, eventName),
      fromBlockInclusive,
      toBlockExclusive
    );

    return logs
      .map((log) => {
        const parsed = this.parseLogOrThrow(this.cssvTransferInterface, log);

        return {
          kind: 'transfer' as const,
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
          transactionIndex: log.transactionIndex,
          logIndex: log.index,
          from: ethers.getAddress(parsed.args.from),
          to: ethers.getAddress(parsed.args.to),
          amountWei: BigInt(parsed.args.value.toString())
        };
      });
  }

  private async readRewardsSettled(
    fromBlockInclusive: number,
    toBlockExclusive: number
  ): Promise<CssvRewardsSettledEvent[]> {
    const eventName = 'RewardsSettled';
    const logs = await this.readChunkedLogs(
      this.config.stakingContractAddress,
      this.getEventTopicHash(this.stakingInterface, eventName),
      fromBlockInclusive,
      toBlockExclusive
    );

    return logs
      .map((log) => {
        const parsed = this.parseLogOrThrow(this.stakingInterface, log);

        return {
          kind: 'rewardsSettled' as const,
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
          transactionIndex: log.transactionIndex,
          logIndex: log.index,
          walletAddress: ethers.getAddress(parsed.args.user),
          pendingWei: BigInt(parsed.args.pending.toString()),
          accruedWei: BigInt(parsed.args.accrued.toString()),
          userIndex: BigInt(parsed.args.userIndex.toString())
        };
      });
  }

  private async readRewardsClaimed(
    fromBlockInclusive: number,
    toBlockExclusive: number
  ): Promise<CssvRewardsClaimedEvent[]> {
    const eventName = 'RewardsClaimed';
    const logs = await this.readChunkedLogs(
      this.config.stakingContractAddress,
      this.getEventTopicHash(this.stakingInterface, eventName),
      fromBlockInclusive,
      toBlockExclusive
    );

    return logs
      .map((log) => {
        const parsed = this.parseLogOrThrow(this.stakingInterface, log);

        return {
          kind: 'rewardsClaimed' as const,
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
          transactionIndex: log.transactionIndex,
          logIndex: log.index,
          walletAddress: ethers.getAddress(parsed.args.user),
          payoutWei: BigInt(parsed.args.amount.toString())
        };
      });
  }

  private async readChunkedLogs(
    address: string,
    topicHash: string,
    fromBlockInclusive: number,
    toBlockExclusive: number
  ): Promise<ethers.Log[]> {
    const provider = this.getProvider();
    const logs: ethers.Log[] = [];

    for (
      let chunkFromBlock = fromBlockInclusive;
      chunkFromBlock < toBlockExclusive;
      chunkFromBlock += this.config.logChunkSizeBlocks
    ) {
      const chunkToExclusive = Math.min(
        toBlockExclusive,
        chunkFromBlock + this.config.logChunkSizeBlocks
      );
      // Provider getLogs uses an inclusive end block, while our snapshot window is half-open.
      const chunkLogs = await provider.getLogs({
        address,
        topics: [topicHash],
        fromBlock: chunkFromBlock,
        toBlock: chunkToExclusive - 1
      });

      logs.push(...chunkLogs);
    }

    return logs;
  }

  private compareEvents(
    left: Pick<CssvSnapshotEvent, 'blockNumber' | 'transactionIndex' | 'logIndex'>,
    right: Pick<CssvSnapshotEvent, 'blockNumber' | 'transactionIndex' | 'logIndex'>
  ): number {
    // Replay order is blockNumber ASC, transactionIndex ASC, logIndex ASC.
    if (left.blockNumber !== right.blockNumber) {
      return left.blockNumber - right.blockNumber;
    }

    if (left.transactionIndex !== right.transactionIndex) {
      return left.transactionIndex - right.transactionIndex;
    }

    return left.logIndex - right.logIndex;
  }

  private getClaimPairKey(transactionHash: string, walletAddress: string): string {
    return `${transactionHash}:${walletAddress}`;
  }

  private getEventTopicHash(
    eventInterface: ethers.Interface,
    eventName: string
  ): string {
    const event = eventInterface.getEvent(eventName);

    if (!event) {
      throw new Error(`Event ${eventName} not found in CSSV snapshot interface`);
    }

    return event.topicHash;
  }

  private parseLogOrThrow(
    eventInterface: ethers.Interface,
    log: ethers.Log
  ): ethers.LogDescription {
    const parsed = eventInterface.parseLog(log);

    if (!parsed) {
      throw new Error(`Unable to parse CSSV snapshot log ${log.transactionHash}`);
    }

    return parsed;
  }
}
