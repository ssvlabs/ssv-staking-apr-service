import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleInit
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { QueryRunner } from 'typeorm';
import { CssvSnapshotRun } from '../../entities/cssv-snapshot-run.entity';
import { CssvSnapshotConfigService } from '../config/cssv-snapshot.config';
import {
  CSSV_SNAPSHOT_CRON_EXPRESSION,
  CSSV_SNAPSHOT_CRON_TIME_ZONE
} from '../constants/cssv-snapshot.constants';
import { CssvSnapshotWalletRowInput } from '../types/cssv-snapshot.types';
import { CssvSnapshotAdvisoryLockService } from './cssv-snapshot-advisory-lock.service';
import { CssvSnapshotBlockchainService } from './cssv-snapshot-blockchain.service';
import { CssvSnapshotBoundaryFinderService } from './cssv-snapshot-boundary-finder.service';
import { CssvSnapshotLogReaderService } from './cssv-snapshot-log-reader.service';
import { CssvSnapshotQueryService } from './cssv-snapshot-query.service';
import { CssvSnapshotReplayService } from './cssv-snapshot-replay.service';
import { CssvSnapshotValidatorService } from './cssv-snapshot-validator.service';
import { CssvSnapshotWriterService } from './cssv-snapshot-writer.service';

interface CssvSnapshotRepairResult {
  deletedRuns: number;
  createdRuns: number;
}

@Injectable()
export class CssvSnapshotOrchestratorService
  implements OnModuleInit, OnApplicationBootstrap
{
  private readonly logger = new Logger(CssvSnapshotOrchestratorService.name);

  constructor(
    private readonly config: CssvSnapshotConfigService,
    private readonly lockService: CssvSnapshotAdvisoryLockService,
    private readonly blockchainService: CssvSnapshotBlockchainService,
    private readonly boundaryFinderService: CssvSnapshotBoundaryFinderService,
    private readonly logReaderService: CssvSnapshotLogReaderService,
    private readonly queryService: CssvSnapshotQueryService,
    private readonly replayService: CssvSnapshotReplayService,
    private readonly validatorService: CssvSnapshotValidatorService,
    private readonly writerService: CssvSnapshotWriterService
  ) {}

  onModuleInit(): void {
    this.logger.log(
      `CSSV snapshot module enabled for token ${this.config.cssvTokenAddress}, deploymentBlock=${this.config.cssvDeploymentBlock}, expectedBlocksPerDay=${this.config.expectedBlocksPerDay}, logChunkSizeBlocks=${this.config.logChunkSizeBlocks}, cron="${this.config.cronExpression}" (${this.config.cronTimeZone})`
    );
  }

  onApplicationBootstrap(): void {
    // Startup backfill reuses the same lock-protected path as the daily cron run.
    void this.runLockedBackfill('startup').catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(`CSSV snapshot startup backfill failed: ${message}`);
    });
  }

  @Cron(CSSV_SNAPSHOT_CRON_EXPRESSION, {
    timeZone: CSSV_SNAPSHOT_CRON_TIME_ZONE
  })
  async handleDailySnapshotCron(): Promise<void> {
    // Cron and startup both flow through the same backfill path so they stay behaviorally identical.
    await this.runLockedBackfill('cron');
  }

  async runLockedBackfill(
    trigger: 'startup' | 'cron' | 'manual' = 'manual'
  ): Promise<number> {
    const runner = await this.lockService.tryAcquire();

    if (!runner) {
      this.logger.warn(
        `CSSV snapshot job is already running, skipping ${trigger} trigger`
      );
      return 0;
    }

    try {
      return await this.backfillUntilCaughtUp(runner, trigger);
    } finally {
      await this.lockService.release(runner);
    }
  }

  async runLockedRepairFromSnapshotDate(
    snapshotDate: string
  ): Promise<CssvSnapshotRepairResult> {
    const runner = await this.lockService.tryAcquire();

    if (!runner) {
      this.logger.warn(
        `CSSV snapshot job is already running, skipping repair from ${snapshotDate}`
      );
      return {
        deletedRuns: 0,
        createdRuns: 0
      };
    }

    try {
      return await this.repairFromSnapshotDate(snapshotDate, runner);
    } finally {
      await this.lockService.release(runner);
    }
  }

  private async backfillUntilCaughtUp(
    lockRunner: QueryRunner,
    trigger: 'startup' | 'cron' | 'manual'
  ): Promise<number> {
    let previousSnapshotRun = await this.queryService.getLatestSnapshotRun();
    let createdRuns = 0;

    while (true) {
      const window = await this.boundaryFinderService.findNextWindow(
        previousSnapshotRun
      );

      if (!window) {
        break;
      }

      this.logger.log(
        `Processing CSSV snapshot ${window.snapshotDate} for [` +
          `${window.fromBlockInclusive}, ${window.toBlockExclusive})`
      );

      previousSnapshotRun = await this.executeSnapshotWindow(
        previousSnapshotRun,
        window.snapshotDate,
        window.fromBlockInclusive,
        window.toBlockExclusive,
        window.snapshotStateBlock,
        lockRunner
      );
      createdRuns += 1;
    }

    this.logger.log(
      `CSSV snapshot ${trigger} finished after creating ${createdRuns} snapshot day(s)`
    );

    return createdRuns;
  }

  private async repairFromSnapshotDate(
    snapshotDate: string,
    lockRunner: QueryRunner
  ): Promise<CssvSnapshotRepairResult> {
    await lockRunner.startTransaction();

    try {
      const deletedRuns = await this.writerService.deleteSnapshotDayAndLater(
        snapshotDate,
        lockRunner
      );
      await lockRunner.commitTransaction();

      this.logger.warn(
        `Deleted ${deletedRuns} CSSV snapshot day(s) from ${snapshotDate}; rebuilding from the last persisted day`
      );

      const createdRuns = await this.backfillUntilCaughtUp(lockRunner, 'manual');

      return {
        deletedRuns,
        createdRuns
      };
    } catch (error) {
      if (lockRunner.isTransactionActive) {
        await lockRunner.rollbackTransaction();
      }

      throw error;
    }
  }

  private async executeSnapshotWindow(
    previousSnapshotRun: CssvSnapshotRun | null,
    snapshotDate: string,
    fromBlockInclusive: number,
    toBlockExclusive: number,
    snapshotStateBlock: number,
    lockRunner: QueryRunner
  ): Promise<CssvSnapshotRun> {
    const previousWalletRows = previousSnapshotRun
      ? await this.queryService.getSnapshotWalletsByRunId(previousSnapshotRun.id)
      : [];
    const previousWalletState = previousWalletRows.map((walletRow) => ({
      walletAddress: walletRow.walletAddress,
      balanceWeiSsv: walletRow.balanceWeiSsv,
      previousGrossClaimableWei: walletRow.grossClaimableEthWei
    }));
    const { events, pairedClaims } = await this.logReaderService.readSnapshotEvents(
      fromBlockInclusive,
      toBlockExclusive
    );
    const walletStateMap =
      this.replayService.createWalletStateMap(previousWalletState);
    const walletQuerySet = this.replayService.buildWalletQuerySet(
      previousWalletState,
      events,
      pairedClaims
    );

    this.replayService.applyEvents(walletStateMap, events, pairedClaims);

    // Keep RPC reads and replay outside the transaction; the DB write path should stay narrow.
    const [currentPreviewByWallet, totalStakedWeiSsv] = await Promise.all([
      this.blockchainService.previewClaimableEthBatchAtBlock(
        walletQuerySet,
        snapshotStateBlock
      ),
      this.blockchainService.totalStakedAtBlock(snapshotStateBlock)
    ]);
    const snapshotWalletRows = this.replayService.buildSnapshotWalletRows(
      walletStateMap,
      currentPreviewByWallet
    );
    const snapshotRun = await this.persistSnapshotWindow(
      previousSnapshotRun,
      snapshotDate,
      fromBlockInclusive,
      toBlockExclusive,
      snapshotStateBlock,
      totalStakedWeiSsv,
      snapshotWalletRows,
      lockRunner
    );

    this.logger.log(
      `Persisted CSSV snapshot ${snapshotDate} with ${snapshotWalletRows.length} wallet row(s)`
    );

    // Empty deployment-era snapshots are expected before the first cSSV activity.
    if (snapshotWalletRows.length > 0 || totalStakedWeiSsv > 0n) {
      this.triggerPostCommitValidation(snapshotRun.id, snapshotDate);
    }

    return snapshotRun;
  }

  private async persistSnapshotWindow(
    previousSnapshotRun: CssvSnapshotRun | null,
    snapshotDate: string,
    fromBlockInclusive: number,
    toBlockExclusive: number,
    snapshotStateBlock: number,
    totalStakedWeiSsv: bigint,
    snapshotWalletRows: CssvSnapshotWalletRowInput[],
    lockRunner: QueryRunner
  ): Promise<CssvSnapshotRun> {
    await lockRunner.startTransaction();

    try {
      const snapshotRun = await this.writerService.insertSnapshotRun(
        {
          snapshotDate,
          snapshotTimeUtc: new Date(`${snapshotDate}T12:00:00.000Z`),
          previousSnapshotBlock: previousSnapshotRun
            ? previousSnapshotRun.toBlockExclusive
            : this.config.cssvDeploymentBlock,
          fromBlockInclusive,
          toBlockExclusive,
          snapshotStateBlock,
          totalStakedWeiSsv,
          walletCount: snapshotWalletRows.length
        },
        lockRunner
      );

      await this.writerService.bulkInsertWalletRows(
        snapshotRun.id,
        snapshotWalletRows,
        lockRunner
      );
      await lockRunner.commitTransaction();

      return snapshotRun;
    } catch (error) {
      if (lockRunner.isTransactionActive) {
        await lockRunner.rollbackTransaction();
      }

      throw error;
    }
  }

  private triggerPostCommitValidation(
    snapshotRunId: string,
    snapshotDate: string
  ): void {
    // Validation is warn-only monitoring and must stay off the write path.
    void this.validatorService
      .validateSnapshot(snapshotRunId)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);

        this.logger.warn(
          `CSSV snapshot validation failed for ${snapshotDate}: ${message}`
        );
      });
  }
}
