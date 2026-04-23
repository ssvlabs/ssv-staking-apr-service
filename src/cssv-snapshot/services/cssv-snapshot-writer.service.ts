import { Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, QueryRunner, Repository } from 'typeorm';
import { CssvSnapshotRun } from '../../entities/cssv-snapshot-run.entity';
import { CssvSnapshotWallet } from '../../entities/cssv-snapshot-wallet.entity';
import {
  CssvBigIntLike,
  CssvSnapshotRunSeed,
  CssvSnapshotWalletRowInput
} from '../types/cssv-snapshot.types';

@Injectable()
export class CssvSnapshotWriterService {
  constructor(
    @InjectRepository(CssvSnapshotRun)
    private readonly snapshotRunRepository: Repository<CssvSnapshotRun>,
    @InjectRepository(CssvSnapshotWallet)
    private readonly snapshotWalletRepository: Repository<CssvSnapshotWallet>
  ) {}

  getSnapshotRunRepository(): Repository<CssvSnapshotRun> {
    return this.snapshotRunRepository;
  }

  getSnapshotWalletRepository(): Repository<CssvSnapshotWallet> {
    return this.snapshotWalletRepository;
  }

  async insertSnapshotRun(
    run: CssvSnapshotRunSeed,
    queryRunner?: QueryRunner
  ): Promise<CssvSnapshotRun> {
    const repository = this.getRunRepository(queryRunner);

    return repository.save(
      repository.create({
        snapshotDate: run.snapshotDate,
        snapshotTimeUtc: run.snapshotTimeUtc,
        previousSnapshotBlock: this.toNumericString(run.previousSnapshotBlock),
        toBlockExclusive: this.toNumericString(run.toBlockExclusive),
        snapshotStateBlock: this.toNumericString(run.snapshotStateBlock),
        fromBlockInclusive: this.toNumericString(run.fromBlockInclusive),
        totalStakedWeiSsv: this.toNumericString(run.totalStakedWeiSsv),
        walletCount: run.walletCount
      })
    );
  }

  async bulkInsertWalletRows(
    snapshotRunId: string | number | bigint,
    rows: CssvSnapshotWalletRowInput[],
    queryRunner?: QueryRunner
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const repository = this.getWalletRepository(queryRunner);

    await repository.insert(
      rows.map((row) => ({
        snapshotRunId: this.toNumericString(snapshotRunId),
        walletAddress: ethers.getAddress(row.walletAddress),
        balanceWeiSsv: this.toNumericString(row.balanceWeiSsv),
        grossClaimableEthWei: this.toNumericString(row.grossClaimableEthWei),
        dailyRewardAccrualWei: this.toNumericString(row.dailyRewardAccrualWei),
        claimedInWindowWei: this.toNumericString(row.claimedInWindowWei),
        burnedDustInWindowWei: this.toNumericString(row.burnedDustInWindowWei)
      }))
    );
  }

  async deleteSnapshotDayAndLater(
    snapshotDate: string,
    queryRunner?: QueryRunner
  ): Promise<number> {
    const repository = this.getRunRepository(queryRunner);
    const deleteResult = await repository
      .createQueryBuilder()
      .delete()
      .from(CssvSnapshotRun)
      .where('snapshot_date >= :snapshotDate', { snapshotDate })
      .execute();

    return deleteResult.affected ?? 0;
  }

  private getRunRepository(queryRunner?: QueryRunner): Repository<CssvSnapshotRun> {
    return this.getManager(queryRunner).getRepository(CssvSnapshotRun);
  }

  private getWalletRepository(
    queryRunner?: QueryRunner
  ): Repository<CssvSnapshotWallet> {
    return this.getManager(queryRunner).getRepository(CssvSnapshotWallet);
  }

  private getManager(queryRunner?: QueryRunner): EntityManager {
    return queryRunner?.manager ?? this.snapshotRunRepository.manager;
  }

  private toNumericString(value: CssvBigIntLike): string {
    return typeof value === 'bigint' ? value.toString() : `${value}`;
  }
}
