import { Injectable } from '@nestjs/common';
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
    return this.snapshotRunRepository.findOne({
      order: {
        snapshotDate: 'DESC'
      }
    });
  }

  async listWalletSnapshots(
    walletAddress: string,
    limit: number,
    offset: number
  ): Promise<CssvSnapshotWallet[]> {
    return this.snapshotWalletRepository
      .createQueryBuilder('wallet')
      .innerJoinAndSelect('wallet.snapshotRun', 'run')
      .where('wallet.walletAddress = :walletAddress', { walletAddress })
      .orderBy('run.snapshotDate', 'DESC')
      .addOrderBy('wallet.snapshotRunId', 'DESC')
      .take(limit)
      .skip(offset)
      .getMany();
  }
}
