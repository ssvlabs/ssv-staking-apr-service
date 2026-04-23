import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CssvSnapshotConfigService } from './config/cssv-snapshot.config';
import { CssvSnapshotRun } from '../entities/cssv-snapshot-run.entity';
import { CssvSnapshotWallet } from '../entities/cssv-snapshot-wallet.entity';
import { CssvSnapshotAdvisoryLockService } from './services/cssv-snapshot-advisory-lock.service';
import { CssvSnapshotBlockchainService } from './services/cssv-snapshot-blockchain.service';
import { CssvSnapshotBoundaryFinderService } from './services/cssv-snapshot-boundary-finder.service';
import { CssvSnapshotLogReaderService } from './services/cssv-snapshot-log-reader.service';
import { CssvSnapshotOrchestratorService } from './services/cssv-snapshot-orchestrator.service';
import { CssvSnapshotQueryService } from './services/cssv-snapshot-query.service';
import { CssvSnapshotReplayService } from './services/cssv-snapshot-replay.service';
import { CssvSnapshotValidatorService } from './services/cssv-snapshot-validator.service';
import { CssvSnapshotWriterService } from './services/cssv-snapshot-writer.service';

@Module({
  imports: [TypeOrmModule.forFeature([CssvSnapshotRun, CssvSnapshotWallet])],
  providers: [
    CssvSnapshotConfigService,
    CssvSnapshotAdvisoryLockService,
    CssvSnapshotBlockchainService,
    CssvSnapshotBoundaryFinderService,
    CssvSnapshotLogReaderService,
    CssvSnapshotOrchestratorService,
    CssvSnapshotQueryService,
    CssvSnapshotReplayService,
    CssvSnapshotValidatorService,
    CssvSnapshotWriterService
  ],
  exports: [
    CssvSnapshotConfigService,
    CssvSnapshotQueryService,
    CssvSnapshotBoundaryFinderService,
    CssvSnapshotLogReaderService,
    CssvSnapshotReplayService,
    CssvSnapshotValidatorService,
    CssvSnapshotWriterService
  ]
})
export class CssvSnapshotModule {}
