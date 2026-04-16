import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CssvSnapshotConfigService } from '../config/cssv-snapshot.config';
import {
  CSSV_SNAPSHOT_CRON_EXPRESSION,
  CSSV_SNAPSHOT_CRON_TIME_ZONE
} from '../constants/cssv-snapshot.constants';
import { CssvSnapshotAdvisoryLockService } from './cssv-snapshot-advisory-lock.service';
import { CssvSnapshotBlockchainService } from './cssv-snapshot-blockchain.service';

@Injectable()
export class CssvSnapshotOrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(CssvSnapshotOrchestratorService.name);

  constructor(
    private readonly config: CssvSnapshotConfigService,
    private readonly lockService: CssvSnapshotAdvisoryLockService,
    private readonly blockchainService: CssvSnapshotBlockchainService
  ) {}

  onModuleInit(): void {
    this.logger.log(
      `CSSV snapshot module enabled for token ${this.config.cssvTokenAddress}, deploymentBlock=${this.config.cssvDeploymentBlock}, expectedBlocksPerDay=${this.config.expectedBlocksPerDay}, logChunkSizeBlocks=${this.config.logChunkSizeBlocks}, cron="${this.config.cronExpression}" (${this.config.cronTimeZone})`
    );
  }

  @Cron(CSSV_SNAPSHOT_CRON_EXPRESSION, {
    timeZone: CSSV_SNAPSHOT_CRON_TIME_ZONE
  })
  async handleDailySnapshotCron(): Promise<void> {
    const runner = await this.lockService.tryAcquire();

    if (!runner) {
      this.logger.warn('CSSV snapshot job is already running, skipping cron tick');
      return;
    }

    try {
      this.logger.log(
        `CSSV snapshot cron triggered for token ${this.config.cssvTokenAddress} via staking ${this.blockchainService.getStakingContractAddress()}; implementation pending`
      );
    } finally {
      await this.lockService.release(runner);
    }
  }
}
