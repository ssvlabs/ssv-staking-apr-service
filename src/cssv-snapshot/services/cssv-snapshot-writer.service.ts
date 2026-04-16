import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CssvSnapshotRun } from '../../entities/cssv-snapshot-run.entity';
import { CssvSnapshotWallet } from '../../entities/cssv-snapshot-wallet.entity';

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
}
