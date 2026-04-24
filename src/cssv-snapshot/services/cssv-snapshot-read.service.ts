import { BadRequestException, Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
import { CssvSnapshotQueryService } from './cssv-snapshot-query.service';
import {
  CssvWalletSnapshotDto,
  CssvWalletSnapshotsResponseDto
} from '../dto/cssv-wallet-snapshot-response.dto';

@Injectable()
export class CssvSnapshotReadService {
  private static readonly DEFAULT_LIMIT = 10;
  private static readonly DEFAULT_OFFSET = 0;

  constructor(private readonly queryService: CssvSnapshotQueryService) {}

  async listWalletSnapshots(
    ownerAddress: string,
    limit = CssvSnapshotReadService.DEFAULT_LIMIT,
    offset = CssvSnapshotReadService.DEFAULT_OFFSET
  ): Promise<CssvWalletSnapshotsResponseDto> {
    if (!ethers.isAddress(ownerAddress)) {
      throw new BadRequestException('Invalid owner address');
    }

    const normalizedOwnerAddress = ethers.getAddress(ownerAddress);
    const walletSnapshots = await this.queryService.listWalletSnapshots(
      normalizedOwnerAddress,
      limit,
      offset
    );

    return {
      ownerAddress: normalizedOwnerAddress,
      snapshots: walletSnapshots.map((walletSnapshot) => {
        const snapshotRun = walletSnapshot.snapshotRun;

        if (!snapshotRun) {
          throw new Error(
            `Missing snapshot run relation for wallet ${walletSnapshot.walletAddress} in run ${walletSnapshot.snapshotRunId}`
          );
        }

        // Public API exposes a simple inclusive block range instead of the internal half-open boundary fields.
        return {
          snapshotDate: snapshotRun.snapshotDate,
          snapshotTimeUtc: snapshotRun.snapshotTimeUtc.toISOString(),
          fromBlock: Number(snapshotRun.fromBlockInclusive),
          toBlock: Number(snapshotRun.snapshotStateBlock),
          balanceWeiSsv: walletSnapshot.balanceWeiSsv,
          dailyRewardAccrualWei: walletSnapshot.dailyRewardAccrualWei,
          grossClaimableEthWei: walletSnapshot.grossClaimableEthWei,
          claimedInWindowWei: walletSnapshot.claimedInWindowWei,
          burnedDustInWindowWei: walletSnapshot.burnedDustInWindowWei
        } satisfies CssvWalletSnapshotDto;
      })
    };
  }
}
