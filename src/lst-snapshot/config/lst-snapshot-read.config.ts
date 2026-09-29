import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Config for serving the stored LST holder snapshot. Needs only the
 * database, so it reads no RPC or chain settings.
 */
@Injectable()
export class LstSnapshotReadConfigService {
  /** Pinned block for the Jun 5 campaign eligibility snapshot. When set,
   *  the eligibility API queries this exact block instead of the lowest
   *  block in the table. */
  readonly campaignBlock: number | null;

  constructor(private readonly configService: ConfigService) {
    const campaignBlockRaw = this.configService.get<string>(
      'LST_SNAPSHOT_CAMPAIGN_BLOCK'
    );

    if (!campaignBlockRaw) {
      this.campaignBlock = null;
      return;
    }

    if (!/^\d+$/.test(campaignBlockRaw)) {
      throw new Error('LST_SNAPSHOT_CAMPAIGN_BLOCK must be a positive integer');
    }

    this.campaignBlock = Number(campaignBlockRaw);
  }
}
