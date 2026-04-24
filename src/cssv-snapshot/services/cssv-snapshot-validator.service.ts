import { Injectable, Logger } from '@nestjs/common';
import { CssvSnapshotWallet } from '../../entities/cssv-snapshot-wallet.entity';
import { CssvSnapshotQueryService } from './cssv-snapshot-query.service';
import { CssvSnapshotBlockchainService } from './cssv-snapshot-blockchain.service';

interface CssvSnapshotValidationResult {
  snapshotDate: string;
  snapshotRunId: string;
  warnings: string[];
}

@Injectable()
export class CssvSnapshotValidatorService {
  private readonly logger = new Logger(CssvSnapshotValidatorService.name);
  private static readonly VALIDATION_SAMPLE_SIZE = 5;

  constructor(
    private readonly queryService: CssvSnapshotQueryService,
    private readonly blockchainService: CssvSnapshotBlockchainService
  ) {}

  async validateSnapshot(
    snapshotRunId: string | number | bigint
  ): Promise<CssvSnapshotValidationResult> {
    const snapshotRun = await this.queryService.getSnapshotRunById(snapshotRunId);

    if (!snapshotRun) {
      const warning = `CSSV snapshot validation skipped: snapshotRunId=${snapshotRunId.toString()} was not found`;

      this.logger.warn(warning);
      return {
        snapshotDate: '',
        snapshotRunId: snapshotRunId.toString(),
        warnings: [warning]
      };
    }

    const walletRows = await this.queryService.getSnapshotWalletsByRunId(
      snapshotRun.id
    );
    const persistedTotalStakedWeiSsv = BigInt(snapshotRun.totalStakedWeiSsv);
    const warnings: string[] = [];

    // Deployment-era snapshots can legitimately be empty before the first cSSV activity.
    if (walletRows.length === 0 && persistedTotalStakedWeiSsv === 0n) {
      return {
        snapshotDate: snapshotRun.snapshotDate,
        snapshotRunId: snapshotRun.id,
        warnings
      };
    }

    await this.validateTotalStaked(
      snapshotRun,
      walletRows,
      persistedTotalStakedWeiSsv,
      warnings
    );
    await this.validateSampledBalances(
      snapshotRun.id,
      snapshotRun.snapshotDate,
      Number(snapshotRun.snapshotStateBlock),
      walletRows,
      warnings
    );
    await this.validateSampledPreviews(
      snapshotRun.id,
      snapshotRun.snapshotDate,
      Number(snapshotRun.snapshotStateBlock),
      walletRows,
      warnings
    );

    for (const warning of warnings) {
      this.logger.warn(warning);
    }

    return {
      snapshotDate: snapshotRun.snapshotDate,
      snapshotRunId: snapshotRun.id,
      warnings
    };
  }

  private async validateTotalStaked(
    snapshotRun: {
      id: string;
      snapshotDate: string;
      snapshotStateBlock: string;
      totalStakedWeiSsv: string;
    },
    walletRows: CssvSnapshotWallet[],
    persistedTotalStakedWeiSsv: bigint,
    warnings: string[]
  ): Promise<void> {
    const snapshotStateBlock = Number(snapshotRun.snapshotStateBlock);
    const expectedTotalStakedWeiSsv = await this.blockchainService.totalStakedAtBlock(
      snapshotStateBlock
    );
    const summedWalletBalancesWeiSsv = walletRows.reduce(
      (accumulator, walletRow) =>
        accumulator +
        (BigInt(walletRow.balanceWeiSsv) > 0n ? BigInt(walletRow.balanceWeiSsv) : 0n),
      0n
    );

    if (persistedTotalStakedWeiSsv !== expectedTotalStakedWeiSsv) {
      warnings.push(
        this.formatWarning(
          'total_staked_rpc_mismatch',
          snapshotRun.snapshotDate,
          snapshotRun.id,
          `expected=${expectedTotalStakedWeiSsv.toString()} actual=${persistedTotalStakedWeiSsv.toString()}`
        )
      );
    }

    if (summedWalletBalancesWeiSsv !== expectedTotalStakedWeiSsv) {
      warnings.push(
        this.formatWarning(
          'wallet_balance_sum_mismatch',
          snapshotRun.snapshotDate,
          snapshotRun.id,
          `expected=${expectedTotalStakedWeiSsv.toString()} actual=${summedWalletBalancesWeiSsv.toString()}`
        )
      );
    }
  }

  private async validateSampledBalances(
    snapshotRunId: string,
    snapshotDate: string,
    snapshotStateBlock: number,
    walletRows: CssvSnapshotWallet[],
    warnings: string[]
  ): Promise<void> {
    const sampledWalletRows = this.getSampledWalletRows(walletRows);
    const expectedBalancesByWallet =
      await this.blockchainService.balanceWeiSsvBatchAtBlock(
        sampledWalletRows.map((walletRow) => walletRow.walletAddress),
        snapshotStateBlock
      );

    for (const walletRow of sampledWalletRows) {
      const expectedBalanceWeiSsv = expectedBalancesByWallet.get(
        walletRow.walletAddress
      );

      if (
        expectedBalanceWeiSsv !== undefined &&
        expectedBalanceWeiSsv !== BigInt(walletRow.balanceWeiSsv)
      ) {
        warnings.push(
          this.formatWarning(
            'sampled_balance_mismatch',
            snapshotDate,
            snapshotRunId,
            `wallet=${walletRow.walletAddress} expected=${expectedBalanceWeiSsv.toString()} actual=${walletRow.balanceWeiSsv}`
          )
        );
      }
    }
  }

  private async validateSampledPreviews(
    snapshotRunId: string,
    snapshotDate: string,
    snapshotStateBlock: number,
    walletRows: CssvSnapshotWallet[],
    warnings: string[]
  ): Promise<void> {
    const sampledWalletRows = this.getSampledWalletRows(walletRows);
    const expectedPreviewsByWallet =
      await this.blockchainService.previewClaimableEthBatchAtBlock(
        sampledWalletRows.map((walletRow) => walletRow.walletAddress),
        snapshotStateBlock
      );

    for (const walletRow of sampledWalletRows) {
      const expectedPreviewWei = expectedPreviewsByWallet.get(
        walletRow.walletAddress
      );

      if (
        expectedPreviewWei !== undefined &&
        expectedPreviewWei !== BigInt(walletRow.grossClaimableEthWei)
      ) {
        warnings.push(
          this.formatWarning(
            'sampled_preview_mismatch',
            snapshotDate,
            snapshotRunId,
            `wallet=${walletRow.walletAddress} expected=${expectedPreviewWei.toString()} actual=${walletRow.grossClaimableEthWei}`
          )
        );
      }
    }
  }

  private getSampledWalletRows(walletRows: CssvSnapshotWallet[]): CssvSnapshotWallet[] {
    return [...walletRows]
      .sort((left, right) => left.walletAddress.localeCompare(right.walletAddress))
      .slice(0, CssvSnapshotValidatorService.VALIDATION_SAMPLE_SIZE);
  }

  private formatWarning(
    mismatchType: string,
    snapshotDate: string,
    snapshotRunId: string,
    details: string
  ): string {
    return (
      `CSSV snapshot validation mismatch type=${mismatchType} ` +
      `snapshotDate=${snapshotDate} snapshotRunId=${snapshotRunId} ` +
      `repairFromSnapshotDate=${snapshotDate} ${details}`
    );
  }
}
