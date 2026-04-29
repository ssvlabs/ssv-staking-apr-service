import { Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CssvSnapshotRun } from '../../entities/cssv-snapshot-run.entity';
import { CssvSnapshotWallet } from '../../entities/cssv-snapshot-wallet.entity';

@Injectable()
export class CssvSnapshotQueryService {
  constructor(
    @InjectRepository(CssvSnapshotRun)
    private readonly snapshotRunRepository: Repository<CssvSnapshotRun>,
    @InjectRepository(CssvSnapshotWallet)
    private readonly snapshotWalletRepository: Repository<CssvSnapshotWallet>
  ) {}

  async getLatestSnapshotRun(): Promise<CssvSnapshotRun | null> {
    const rows = await this.snapshotRunRepository.find({
      order: {
        snapshotDate: 'DESC'
      },
      take: 1
    });

    return rows[0] ?? null;
  }

  async getSnapshotRunById(
    snapshotRunId: string | number | bigint
  ): Promise<CssvSnapshotRun | null> {
    return this.snapshotRunRepository.findOne({
      where: {
        id: snapshotRunId.toString()
      }
    });
  }

  async getSnapshotWalletsByRunId(
    snapshotRunId: string | number | bigint
  ): Promise<CssvSnapshotWallet[]> {
    return this.snapshotWalletRepository.find({
      where: {
        snapshotRunId: snapshotRunId.toString()
      }
    });
  }

  async listWalletSnapshots(
    walletAddress: string,
    limit: number,
    offset: number
  ): Promise<CssvSnapshotWallet[]> {
    const normalizedWalletAddress = ethers.getAddress(walletAddress);

    return this.snapshotWalletRepository
      .createQueryBuilder('wallet')
      .innerJoinAndSelect('wallet.snapshotRun', 'run')
      .where('wallet.walletAddress = :walletAddress', {
        walletAddress: normalizedWalletAddress
      })
      .orderBy('run.snapshotDate', 'DESC')
      .addOrderBy('wallet.snapshotRunId', 'DESC')
      .take(limit)
      .skip(offset)
      .getMany();
  }
}
