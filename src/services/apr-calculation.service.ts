import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ethers } from 'ethers';
import { AprSample } from '../entities/apr-sample.entity';
import { BlockchainService } from './blockchain.service';
import { CoinGeckoService } from './coingecko.service';
import { EcService } from './ec.service';

const BLOCKS_PER_YEAR = 2_613_400;
const EFFECTIVE_BALANCE_PER_VALIDATOR = 32;

export interface CurrentAprResponse {
  apr: number | null;
  aprProjected: number | null;
  lastUpdated: number;
}

@Injectable()
export class AprCalculationService {
  private readonly logger = new Logger(AprCalculationService.name);

  constructor(
    @InjectRepository(AprSample)
    private aprSampleRepository: Repository<AprSample>,
    private blockchainService: BlockchainService,
    private coinGeckoService: CoinGeckoService,
    private ecService: EcService
  ) {
    this.logger.log('AprCalculationService constructed');
  }

  /**
   * Latest APR formula:
   * APR% = ((F / 1e18) * (EB / 32) * B * P_ETH) / (S * P_SSV) * 100
   */
  private computeAprFromInputs(
    networkFeeWei: bigint,
    effectiveBalanceEth: string,
    totalEligibleSsvStaked: number,
    priceEth: number,
    priceSsv: number,
    formulaName: 'APR' | 'APR_PROJECTED'
  ): number | null {
    const feeEth = Number(ethers.formatEther(networkFeeWei));
    const effectiveBalance = Number(effectiveBalanceEth);

    if (!Number.isFinite(feeEth) || feeEth < 0) {
      this.logger.warn(
        `${formulaName}: invalid network fee (wei=${networkFeeWei.toString()})`
      );
      return null;
    }

    if (!Number.isFinite(effectiveBalance) || effectiveBalance < 0) {
      this.logger.warn(
        `${formulaName}: invalid effective balance: "${effectiveBalanceEth}"`
      );
      return null;
    }

    if (
      !Number.isFinite(priceEth) ||
      !Number.isFinite(priceSsv) ||
      priceEth <= 0 ||
      priceSsv <= 0
    ) {
      this.logger.warn(
        `${formulaName}: invalid prices. priceEth=${priceEth}, priceSsv=${priceSsv}`
      );
      return null;
    }

    const denominator = totalEligibleSsvStaked * priceSsv;
    if (!Number.isFinite(denominator) || denominator <= 0) {
      this.logger.warn(
        `${formulaName}: invalid denominator. totalEligibleSsvStaked=${totalEligibleSsvStaked}, priceSsv=${priceSsv}`
      );
      return null;
    }

    const apr =
      ((feeEth *
        (effectiveBalance / EFFECTIVE_BALANCE_PER_VALIDATOR) *
        BLOCKS_PER_YEAR *
        priceEth) /
        denominator) *
      100;

    if (!Number.isFinite(apr)) {
      this.logger.warn(`${formulaName}: calculated APR is not finite`);
      return null;
    }

    return apr;
  }

  private async computeCurrentAndProjectedApr(
    networkFeeWei: bigint,
    priceEth: number,
    priceSsv: number
  ): Promise<{ apr: number | null; aprProjected: number | null }> {
    try {
      // EC validators endpoint is gwei; EcService converts it to ETH.
      const [
        totalStakedEth,
        clustersEffectiveBalanceEth,
        validatorsEffectiveBalanceEth
      ] = await Promise.all([
        this.blockchainService.getTotalStaked(),
        this.ecService.getClustersEffectiveBalance(),
        this.ecService.getValidatorsEffectiveBalance()
      ]);

      const totalEligibleSsvStaked = Number(totalStakedEth);
      if (
        !Number.isFinite(totalEligibleSsvStaked) ||
        totalEligibleSsvStaked <= 0
      ) {
        this.logger.warn(
          `Invalid normalized totalStaked value from contract: ${totalStakedEth}`
        );
        return { apr: null, aprProjected: null };
      }

      const apr = this.computeAprFromInputs(
        networkFeeWei,
        clustersEffectiveBalanceEth,
        totalEligibleSsvStaked,
        priceEth,
        priceSsv,
        'APR'
      );

      const aprProjected = this.computeAprFromInputs(
        networkFeeWei,
        validatorsEffectiveBalanceEth,
        totalEligibleSsvStaked,
        priceEth,
        priceSsv,
        'APR_PROJECTED'
      );

      return { apr, aprProjected };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.warn(
        `Failed to fetch effective balances for APR computation: ${message}`
      );
      if (stack) {
        this.logger.debug(`Stack trace: ${stack}`);
      }
      return { apr: null, aprProjected: null };
    }
  }

  /**
   * Scheduled job to collect APR sample every 3 hours.
   * Cron expression runs at minute 0 every third hour.
   */
  @Cron('0 */3 * * *')
  async collectAprSample(): Promise<AprSample> {
    try {
      const [networkFeeWei, prices] = await Promise.all([
        this.blockchainService.getNetworkFee(),
        this.coinGeckoService.getPrices()
      ]);

      const timestamp = new Date();

      const { apr, aprProjected } = await this.computeCurrentAndProjectedApr(
        networkFeeWei,
        prices.ethPrice,
        prices.ssvPrice
      );

      const sample = this.aprSampleRepository.create({
        timestamp,
        networkFeeWei: networkFeeWei.toString(),
        ethPrice: prices.ethPrice.toString(),
        ssvPrice: prices.ssvPrice.toString(),
        currentApr: apr !== null ? apr.toFixed(2) : null,
        aprProjected: aprProjected !== null ? aprProjected.toFixed(2) : null,
        deltaIndex: null,
        deltaTime: null
      });

      const savedSample = await this.aprSampleRepository.save(sample);

      return savedSample;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`=== collectAprSample() FAILED: ${message} ===`);
      if (stack) {
        this.logger.error(`Stack trace: ${stack}`);
      }
      throw error;
    }
  }

  /**
   * Get the two latest samples for APR display
   */
  async getLatestTwoSamples(): Promise<AprSample[]> {
    const samples = await this.aprSampleRepository.find({
      order: { timestamp: 'DESC' },
      take: 2
    });
    return samples;
  }

  /**
   * Get current APR data for the API
   */
  async getCurrentApr(): Promise<CurrentAprResponse | null> {
    try {
      const [networkFeeWei, prices] = await Promise.all([
        this.blockchainService.getNetworkFee(),
        this.coinGeckoService.getPrices()
      ]);

      const { apr, aprProjected } = await this.computeCurrentAndProjectedApr(
        networkFeeWei,
        prices.ethPrice,
        prices.ssvPrice
      );

      const lastUpdated = Date.now();

      return {
        apr,
        aprProjected,
        lastUpdated
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`=== getCurrentApr() FAILED: ${message} ===`);
      if (stack) {
        this.logger.error(`Stack trace: ${stack}`);
      }
      return null;
    }
  }

  /**
   * Get historical APR samples
   */
  async getHistoricalSamples(
    limit: number = 30,
    startDate?: Date,
    endDate?: Date
  ): Promise<AprSample[]> {
    const queryBuilder = this.aprSampleRepository
      .createQueryBuilder('sample')
      .orderBy('sample.timestamp', 'DESC')
      .take(limit);

    if (startDate) {
      queryBuilder.andWhere('sample.timestamp >= :startDate', { startDate });
    }

    if (endDate) {
      queryBuilder.andWhere('sample.timestamp <= :endDate', { endDate });
    }

    const samples = await queryBuilder.getMany();
    return samples;
  }

  /**
   * Clean up old samples (keep last 365 days)
   */
  @Cron(CronExpression.EVERY_WEEK)
  async cleanupOldSamples(): Promise<void> {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    await this.aprSampleRepository.delete({
      timestamp: LessThan(oneYearAgo)
    });
  }

  /**
   * Manual trigger for APR collection (for testing)
   */
  async manualCollectSample(): Promise<AprSample> {
    return await this.collectAprSample();
  }
}
