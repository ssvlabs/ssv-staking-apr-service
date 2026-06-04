import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LstHolderSnapshot } from '../entities/lst-holder-snapshot.entity';
import { LstSnapshotConfigService } from './config/lst-snapshot.config';
import { LstSnapshotController } from './controllers/lst-snapshot.controller';
import { LstSnapshotAdvisoryLockService } from './services/lst-snapshot-advisory-lock.service';
import { LstSnapshotBlockchainService } from './services/lst-snapshot-blockchain.service';
import { LstSnapshotOrchestratorService } from './services/lst-snapshot-orchestrator.service';
import { LstSnapshotReadService } from './services/lst-snapshot-read.service';
import { LstSnapshotWriterService } from './services/lst-snapshot-writer.service';

@Module({
  imports: [TypeOrmModule.forFeature([LstHolderSnapshot])],
  controllers: [LstSnapshotController],
  providers: [
    LstSnapshotConfigService,
    LstSnapshotAdvisoryLockService,
    LstSnapshotBlockchainService,
    LstSnapshotOrchestratorService,
    LstSnapshotReadService,
    LstSnapshotWriterService
  ]
})
export class LstSnapshotModule {}
