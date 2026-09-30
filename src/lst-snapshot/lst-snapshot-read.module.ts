import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LstHolderSnapshot } from '../entities/lst-holder-snapshot.entity';
import { LstSnapshotReadConfigService } from './config/lst-snapshot-read.config';
import { LstSnapshotReadController } from './controllers/lst-snapshot-read.controller';
import { LstSnapshotReadService } from './services/lst-snapshot-read.service';

/**
 * Serves the stored LST holder snapshot. Registers only the eligibility
 * GET route: no cron, no admin trigger, no RPC calls, no writes.
 */
@Module({
  imports: [TypeOrmModule.forFeature([LstHolderSnapshot])],
  controllers: [LstSnapshotReadController],
  providers: [LstSnapshotReadConfigService, LstSnapshotReadService]
})
export class LstSnapshotReadModule {}
