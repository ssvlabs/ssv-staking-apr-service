import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { LstHolderSnapshot } from '../../entities/lst-holder-snapshot.entity';
import { LstEligibilityResult } from '../types/lst-snapshot.types';

@Injectable()
export class LstSnapshotReadService {
  constructor(
    @InjectRepository(LstHolderSnapshot)
    private readonly repository: Repository<LstHolderSnapshot>
  ) {}

  async getEligibility(rawAddress: string): Promise<LstEligibilityResult> {
    let walletAddress: string;

    try {
      walletAddress = ethers.getAddress(rawAddress);
    } catch {
      throw new BadRequestException(`Invalid wallet address: ${rawAddress}`);
    }

    // Use the earliest snapshot block (the Jun 5 eligibility snapshot).
    // If multiple blocks exist (e.g. daily snapshots after Jun 9), we want the
    // first one because campaign eligibility is determined at that one block.
    const earliestBlockRow = await this.repository
      .createQueryBuilder('s')
      .select('MIN(s.snapshot_block)', 'block')
      .getRawOne<{ block: string | null }>();

    const snapshotBlock = earliestBlockRow?.block ?? null;

    if (!snapshotBlock) {
      return { walletAddress, eligible: false, snapshotBlock: null, tokens: [] };
    }

    const rows = await this.repository.find({
      where: { walletAddress, snapshotBlock }
    });

    return {
      walletAddress,
      eligible: rows.length > 0,
      snapshotBlock,
      tokens: rows.map((row) => ({
        symbol: row.tokenSymbol,
        tokenAddress: row.tokenAddress,
        balanceWei: row.balanceWei
      }))
    };
  }

  async getLatestSnapshotBlock(): Promise<number | null> {
    const row = await this.repository
      .createQueryBuilder('s')
      .select('MAX(s.snapshot_block)', 'block')
      .getRawOne<{ block: string | null }>();

    return row?.block ? Number(row.block) : null;
  }
}
