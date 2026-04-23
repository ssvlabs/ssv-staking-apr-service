import { Injectable, Logger } from '@nestjs/common';
import { CssvSnapshotRun } from '../../entities/cssv-snapshot-run.entity';
import { CssvSnapshotConfigService } from '../config/cssv-snapshot.config';
import { GENESIS_TIMESTAMPS_BY_CHAIN_ID } from '../constants/cssv-snapshot.constants';
import { CssvBlockHeader, CssvSnapshotWindow } from '../types/cssv-snapshot.types';
import { CssvSnapshotBlockchainService } from './cssv-snapshot-blockchain.service';

@Injectable()
export class CssvSnapshotBoundaryFinderService {
  private readonly logger = new Logger(CssvSnapshotBoundaryFinderService.name);

  constructor(
    private readonly config: CssvSnapshotConfigService,
    private readonly blockchainService: CssvSnapshotBlockchainService
  ) {}

  getGenesisTimestamp(chainId: number): number {
    const genesisTimestamp = GENESIS_TIMESTAMPS_BY_CHAIN_ID[chainId];

    if (!genesisTimestamp) {
      throw new Error(
        `Unsupported chainId ${chainId} for CSSV snapshot boundary finder`
      );
    }

    return genesisTimestamp;
  }

  getApproximateNextSnapshotBlock(prevSnapshotBlock: number, expectedBlocksPerDay: number): number {
    return prevSnapshotBlock + expectedBlocksPerDay;
  }

  async findNextWindow(
    previousSnapshotRun: CssvSnapshotRun | null
  ): Promise<CssvSnapshotWindow | null> {
    const latestBlock = await this.blockchainService.getLatestBlockHeader();
    const snapshotDate = previousSnapshotRun
      ? this.getNextSnapshotDate(previousSnapshotRun.snapshotDate)
      : await this.getFirstSnapshotDate();
    const snapshotNoonTimestamp = this.getSnapshotNoonTimestamp(snapshotDate);

    // A day is processable only once we have at least one block strictly after noon.
    if (latestBlock.timestamp <= snapshotNoonTimestamp) {
      this.logger.warn(
        `Snapshot date ${snapshotDate} is not processable yet: latest block ` +
        `${latestBlock.number} has timestamp ${latestBlock.timestamp}, ` +
        `but first block after noon requires timestamp > ${snapshotNoonTimestamp}`
      );

      return null;
    }

    // If we already have a snapshot, the next window starts exactly at the previous
    // window's exclusive end. Otherwise we bootstrap from the configured snapshot start block.
    // The initial block guess is only a search heuristic; the final boundary always
    // comes from timestamp refinement + binary search to the first block after noon.
    const fromBlockInclusive = previousSnapshotRun
      ? Number(previousSnapshotRun.toBlockExclusive)
      : this.config.cssvSnapshotStartBlock;
    const approximateBlock = previousSnapshotRun
      ? this.getApproximateNextSnapshotBlock(
          fromBlockInclusive,
          this.config.expectedBlocksPerDay
        )
      : await this.getApproximateFirstSnapshotBlock(
          snapshotNoonTimestamp,
          latestBlock.number
        );
    const toBlockExclusive = await this.findFirstBlockAfterTimestamp(
      snapshotNoonTimestamp,
      Math.max(fromBlockInclusive, approximateBlock),
      latestBlock.number
    );

    return {
      snapshotDate,
      fromBlockInclusive,
      toBlockExclusive,
      // eth_call at block N sees post-block-N state, so the snapshot state is N - 1.
      snapshotStateBlock: toBlockExclusive - 1
    };
  }

  private async getFirstSnapshotDate(): Promise<string> {
    const startBlock = await this.blockchainService.getBlockHeader(
      this.config.cssvSnapshotStartBlock
    );
    const startTimestamp = startBlock.timestamp;
    const startDate = new Date(startTimestamp * 1000);
    const sameDaySnapshotDate = this.formatUtcDate(startDate);
    const sameDayNoonTimestamp =
      this.getSnapshotNoonTimestamp(sameDaySnapshotDate);

    // The first snapshot day is the first noon boundary at or after the configured start block.
    if (startTimestamp <= sameDayNoonTimestamp) {
      return sameDaySnapshotDate;
    }

    return this.getNextSnapshotDate(sameDaySnapshotDate);
  }

  private async getApproximateFirstSnapshotBlock(
    snapshotNoonTimestamp: number,
    latestBlockNumber: number
  ): Promise<number> {
    const genesisTimestamp = this.getGenesisTimestamp(this.config.chainId);
    const secondsPerBlock = Math.max(
      1,
      Math.floor(86_400 / this.config.expectedBlocksPerDay)
    );
    const estimatedFromGenesis = Math.max(
      0,
      Math.floor((snapshotNoonTimestamp - genesisTimestamp) / secondsPerBlock)
    );

    return Math.min(
      latestBlockNumber,
      Math.max(this.config.cssvSnapshotStartBlock, estimatedFromGenesis)
    );
  }

  private async findFirstBlockAfterTimestamp(
    targetTimestamp: number,
    initialGuessBlockNumber: number,
    latestBlockNumber: number
  ): Promise<number> {
    const blockCache = new Map<number, CssvBlockHeader>();
    const getHeader = async (blockNumber: number): Promise<CssvBlockHeader> => {
      const normalizedBlockNumber = Math.max(
        0,
        Math.min(blockNumber, latestBlockNumber)
      );
      const cached = blockCache.get(normalizedBlockNumber);

      if (cached) {
        return cached;
      }

      const header = await this.blockchainService.getBlockHeader(
        normalizedBlockNumber
      );
      blockCache.set(normalizedBlockNumber, header);

      return header;
    };

    const initialHeader = await getHeader(initialGuessBlockNumber);
    let lowerBound: CssvBlockHeader;
    let upperBound: CssvBlockHeader;
    let step = Math.max(
      1,
      Math.floor(this.config.expectedBlocksPerDay / 8)
    );

    if (initialHeader.timestamp <= targetTimestamp) {
      lowerBound = initialHeader;
      upperBound = await getHeader(Math.min(latestBlockNumber, lowerBound.number + 1));

      // Expand upward until we bracket the first block that lands after noon.
      while (upperBound.timestamp <= targetTimestamp) {
        lowerBound = upperBound;
        upperBound = await getHeader(
          Math.min(latestBlockNumber, upperBound.number + step)
        );
        step *= 2;
      }
    } else {
      upperBound = initialHeader;
      lowerBound = await getHeader(Math.max(0, upperBound.number - 1));

      // If the estimate overshot, walk backward until we bracket noon from below.
      while (lowerBound.timestamp > targetTimestamp) {
        upperBound = lowerBound;
        lowerBound = await getHeader(Math.max(0, lowerBound.number - step));
        step *= 2;
      }
    }

    let left = lowerBound.number + 1;
    let right = upperBound.number;

    // Invariant: block(left - 1) <= targetTimestamp and block(right) > targetTimestamp.
    while (left < right) {
      const middle = Math.floor((left + right) / 2);
      const middleHeader = await getHeader(middle);

      if (middleHeader.timestamp > targetTimestamp) {
        right = middle;
      } else {
        left = middle + 1;
      }
    }

    return left;
  }

  private getNextSnapshotDate(snapshotDate: string): string {
    const date = new Date(`${snapshotDate}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);

    return this.formatUtcDate(date);
  }

  private getSnapshotNoonTimestamp(snapshotDate: string): number {
    return Math.floor(Date.parse(`${snapshotDate}T12:00:00.000Z`) / 1000);
  }

  private formatUtcDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
