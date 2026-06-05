import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { LstHolderSnapshot } from '../../entities/lst-holder-snapshot.entity';
import { LstHolderRowInput } from '../types/lst-snapshot.types';

const INSERT_CHUNK_SIZE = 1_000;

@Injectable()
export class LstSnapshotWriterService {
  constructor(
    @InjectRepository(LstHolderSnapshot)
    private readonly repository: Repository<LstHolderSnapshot>
  ) {}

  async bulkInsert(
    rows: LstHolderRowInput[],
    snapshotBlock: number,
    snapshotAt: Date
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);

      await this.repository
        .createQueryBuilder()
        .insert()
        .into(LstHolderSnapshot)
        .values(
          chunk.map((row) => ({
            snapshotBlock: String(snapshotBlock),
            snapshotAt,
            walletAddress: ethers.getAddress(row.walletAddress),
            tokenAddress: ethers.getAddress(row.tokenAddress),
            tokenSymbol: row.tokenSymbol,
            balanceWei: row.balanceWei.toString()
          }))
        )
        .orIgnore()
        .execute();
    }
  }

  async countBySnapshotBlock(snapshotBlock: number): Promise<number> {
    return this.repository.count({
      where: { snapshotBlock: String(snapshotBlock) }
    });
  }

  async countBySnapshotBlockAndToken(
    snapshotBlock: number,
    tokenAddress: string
  ): Promise<number> {
    return this.repository.count({
      where: {
        snapshotBlock: String(snapshotBlock),
        tokenAddress: ethers.getAddress(tokenAddress)
      }
    });
  }

  async getLatestSnapshotBlockForToken(tokenAddress: string): Promise<number | null> {
    const result = await this.repository
      .createQueryBuilder('s')
      .select('MAX(CAST(s.snapshotBlock AS BIGINT))', 'maxBlock')
      .where('s.tokenAddress = :tokenAddress', { tokenAddress: ethers.getAddress(tokenAddress) })
      .getRawOne<{ maxBlock: string | null }>();

    if (!result?.maxBlock) return null;
    return Number(result.maxBlock);
  }

  async getWalletAddressesForToken(
    snapshotBlock: number,
    tokenAddress: string
  ): Promise<string[]> {
    const rows = await this.repository.find({
      where: {
        snapshotBlock: String(snapshotBlock),
        tokenAddress: ethers.getAddress(tokenAddress)
      },
      select: ['walletAddress']
    });
    return rows.map((r) => r.walletAddress);
  }
}
