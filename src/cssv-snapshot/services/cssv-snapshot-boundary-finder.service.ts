import { Injectable } from '@nestjs/common';
import { GENESIS_TIMESTAMPS_BY_CHAIN_ID } from '../constants/cssv-snapshot.constants';

@Injectable()
export class CssvSnapshotBoundaryFinderService {
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
}
