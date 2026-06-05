import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { LstHolderSnapshot } from '../../entities/lst-holder-snapshot.entity';
import { LstSnapshotConfigService } from '../config/lst-snapshot.config';
import { LstEligibilityResult } from '../types/lst-snapshot.types';

@Injectable()
export class LstSnapshotReadService {
  constructor(
    @InjectRepository(LstHolderSnapshot)
    private readonly repository: Repository<LstHolderSnapshot>,
    private readonly config: LstSnapshotConfigService
  ) {}

  async getEligibility(rawAddress: string): Promise<LstEligibilityResult> {
    let walletAddress: string;

    try {
      walletAddress = ethers.getAddress(rawAddress);
    } catch {
      throw new BadRequestException(`Invalid wallet address: ${rawAddress}`);
    }

    const snapshotBlock = await this.resolveCampaignBlock();

    if (!snapshotBlock) {
      return { walletAddress, eligible: false, snapshotBlock: null, tokens: [] };
    }

    const rows = await this.repository.find({
      where: { walletAddress, snapshotBlock: String(snapshotBlock) }
    });

    return {
      walletAddress,
      eligible: rows.length > 0,
      snapshotBlock: String(snapshotBlock),
      tokens: rows.map((row) => ({
        symbol: row.tokenSymbol,
        tokenAddress: row.tokenAddress,
        balanceWei: row.balanceWei
      }))
    };
  }

  /**
   * Returns the canonical campaign block to use for eligibility queries.
   * Prefers LST_SNAPSHOT_CAMPAIGN_BLOCK (explicit pin) over the DB minimum,
   * so test runs on earlier blocks never silently become the campaign snapshot.
   */
  async resolveCampaignBlock(): Promise<number | null> {
    if (this.config.campaignBlock !== null) {
      return this.config.campaignBlock;
    }

    const row = await this.repository
      .createQueryBuilder('s')
      .select('MIN(s.snapshot_block)', 'block')
      .getRawOne<{ block: string | null }>();

    return row?.block ? Number(row.block) : null;
  }
}
