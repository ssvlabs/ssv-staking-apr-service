import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ethers } from 'ethers';
import {
  LST_SNAPSHOT_CRON_EXPRESSION,
  LST_SNAPSHOT_CRON_TIME_ZONE,
  LST_TOKENS,
  LstTokenConfig
} from '../constants/lst-snapshot.constants';
import { LstHolderRowInput } from '../types/lst-snapshot.types';
import { LstSnapshotAdvisoryLockService } from './lst-snapshot-advisory-lock.service';
import { LstSnapshotBlockchainService } from './lst-snapshot-blockchain.service';
import { LstSnapshotWriterService } from './lst-snapshot-writer.service';

@Injectable()
export class LstSnapshotOrchestratorService {
  private readonly logger = new Logger(LstSnapshotOrchestratorService.name);

  constructor(
    private readonly lockService: LstSnapshotAdvisoryLockService,
    private readonly blockchainService: LstSnapshotBlockchainService,
    private readonly writerService: LstSnapshotWriterService
  ) {}

  @Cron(LST_SNAPSHOT_CRON_EXPRESSION, { timeZone: LST_SNAPSHOT_CRON_TIME_ZONE })
  async handleScheduledSnapshot(): Promise<void> {
    try {
      await this.runLocked('cron');
    } catch {
      // Error already logged inside runLocked; swallow here so the cron scheduler
      // does not treat this as an unhandled rejection.
    }
  }

  async runLocked(trigger: 'cron' | 'manual', blockNumber?: number): Promise<void> {
    const runner = await this.lockService.tryAcquire();

    if (!runner) {
      this.logger.warn(
        `LST snapshot job is already running, skipping ${trigger} trigger`
      );
      return;
    }

    try {
      await this.run(trigger, blockNumber);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `LST snapshot FAILED (trigger=${trigger}, block=${blockNumber ?? 'latest'}): ${message}`,
        error instanceof Error ? error.stack : undefined
      );
      throw error;
    } finally {
      await this.lockService.release(runner);
    }
  }

  private async run(trigger: string, blockNumber?: number): Promise<void> {
    const snapshotBlock =
      blockNumber ?? (await this.blockchainService.getLatestBlockNumber());
    const existingCount =
      await this.writerService.countBySnapshotBlock(snapshotBlock);

    if (existingCount > 0) {
      this.logger.log(
        `LST snapshot at block ${snapshotBlock} already has ${existingCount} row(s); skipping (${trigger})`
      );
      return;
    }

    this.logger.log(`Starting LST snapshot at block ${snapshotBlock} (${trigger})`);

    const snapshotAt = await this.blockchainService.getBlockTimestamp(snapshotBlock);
    let totalRows = 0;

    for (const token of LST_TOKENS) {
      const rows = await this.snapshotToken(token, snapshotBlock, snapshotAt);
      totalRows += rows;
    }

    this.logger.log(
      `LST snapshot at block ${snapshotBlock} complete — ${totalRows} total holder row(s) across ${LST_TOKENS.length} token(s)`
    );
  }

  private async snapshotToken(
    token: LstTokenConfig,
    snapshotBlock: number,
    snapshotAt: Date
  ): Promise<number> {
    const normalizedAddress = ethers.getAddress(token.address);

    // Skip if this token's rows already exist (allows resuming a partial run).
    const existing = await this.writerService.countBySnapshotBlockAndToken(
      snapshotBlock,
      normalizedAddress
    );

    if (existing > 0) {
      this.logger.log(
        `${token.symbol}: already snapshotted at block ${snapshotBlock} (${existing} rows), skipping`
      );
      return existing;
    }

    // Per-token previous block: if this specific token was never snapshotted, do a full scan.
    const previousBlock =
      await this.writerService.getLatestSnapshotBlockForToken(normalizedAddress);

    let candidates: Set<string>;

    if (previousBlock !== null && previousBlock < snapshotBlock) {
      // Incremental: delta transfers since last snapshot for this token + all previous holders.
      this.logger.log(
        `${token.symbol}: incremental scan block ${previousBlock} → ${snapshotBlock}`
      );

      const [deltaRecipients, previousHolders] = await Promise.all([
        this.blockchainService.collectRecipients(
          normalizedAddress,
          previousBlock,
          snapshotBlock
        ),
        this.writerService.getWalletAddressesForToken(previousBlock, normalizedAddress)
      ]);

      candidates = new Set([...previousHolders, ...deltaRecipients]);

      this.logger.log(
        `${token.symbol}: ${previousHolders.length} previous holders + ${deltaRecipients.size} new recipients = ${candidates.size} candidates`
      );
    } else {
      // Full scan from deployment block (first run for this token, or previousBlock >= snapshotBlock).
      this.logger.log(
        `${token.symbol}: full scan from block ${token.deploymentBlock} to ${snapshotBlock}`
      );

      candidates = await this.blockchainService.collectRecipients(
        normalizedAddress,
        token.deploymentBlock,
        snapshotBlock
      );
    }

    this.logger.log(
      `${token.symbol}: calling balanceOf for ${candidates.size} address(es) at block ${snapshotBlock}`
    );

    const balances = await this.blockchainService.batchBalanceOf(
      normalizedAddress,
      [...candidates],
      snapshotBlock
    );

    const rows: LstHolderRowInput[] = [];

    for (const [wallet, balance] of balances) {
      if (balance > 0n) {
        rows.push({
          walletAddress: wallet,
          tokenAddress: normalizedAddress,
          tokenSymbol: token.symbol,
          balanceWei: balance
        });
      }
    }

    await this.writerService.bulkInsert(rows, snapshotBlock, snapshotAt);

    this.logger.log(
      `${token.symbol}: persisted ${rows.length} holder row(s) at block ${snapshotBlock}`
    );

    return rows.length;
  }
}
