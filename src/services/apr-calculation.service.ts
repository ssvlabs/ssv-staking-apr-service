import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AprSample } from '../entities/apr-sample.entity';
import { BlockchainService } from './blockchain.service';
import { CoinGeckoService } from './coingecko.service';
import { EcService } from './ec.service';

const SECONDS_PER_YEAR = 31_536_000; // 365 * 24 * 60 * 60

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
  ) {}

  /**
   * Scheduled job to collect APR sample every 24 hours
   * Default cron: 0 0 * * * (every day at midnight UTC)
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async collectAprSample(): Promise<AprSample> {
    this.logger.log('Starting APR sample collection');

    try {
      // Fetch data from blockchain and CoinGecko in parallel
      const [accEthPerShare, prices] = await Promise.all([
        this.blockchainService.getAccEthPerShare(),
        this.coinGeckoService.getPrices()
      ]);

      const timestamp = new Date();

      // Calculate APR using the formula:
      // APR = ratePerShare × SECONDS_PER_YEAR × (priceEth / priceSsv) × 100
      const apr = this.computeApr(
        accEthPerShare,
        prices.ethPrice,
        prices.ssvPrice
      );

      const aprProjected = await this.getProjectedApr(apr);

      // Save the new sample
      const sample = this.aprSampleRepository.create({
        timestamp,
        accEthPerShare: accEthPerShare.toString(),
        ethPrice: prices.ethPrice.toString(),
        ssvPrice: prices.ssvPrice.toString(),
        currentApr: apr !== null ? apr.toFixed(2) : null,
        aprProjected: aprProjected !== null ? aprProjected.toFixed(2) : null,
        deltaIndex: null,
        deltaTime: null
      });

      const savedSample = await this.aprSampleRepository.save(sample);

      this.logger.log(
        `APR sample collected successfully. APR: ${apr !== null ? apr.toFixed(2) : '--'}%`
      );

      return savedSample;
    } catch (error) {
      this.logger.error('Failed to collect APR sample', error);
      throw error;
    }
  }

  /**
   * Compute APR from accEthPerShare and token prices
   * Formula: APR = ratePerShare × SECONDS_PER_YEAR × (priceEth / priceSsv) × 100
   */
  private computeApr(
    accEthPerShare: bigint,
    priceEth: number,
    priceSsv: number
  ): number | null {
    if (!Number.isFinite(priceEth) || !Number.isFinite(priceSsv)) {
      this.logger.warn('Invalid price data');
      return null;
    }

    // Convert accEthPerShare from wei to ether (18 decimals)
    const ratePerShare = Number(accEthPerShare) / 1e18;

    if (!Number.isFinite(ratePerShare) || ratePerShare <= 0) {
      this.logger.warn(`Invalid ratePerShare: ${ratePerShare}`);
      return null;
    }

    // APR = ratePerShare × SECONDS_PER_YEAR × (priceEth / priceSsv) × 100
    const apr = ratePerShare * SECONDS_PER_YEAR * (priceEth / priceSsv) * 100;

    if (!Number.isFinite(apr)) {
      this.logger.warn(`Calculated APR is not finite: ${apr}`);
      return null;
    }

    this.logger.log(`Computed APR: ${apr.toFixed(2)}%`);
    return apr;
  }

  /**
   * Compute projected APR using effective balances.
   * Formula: aprProjected = apr × (clustersEffectiveBalance / validatorsEffectiveBalance)
   */
  private computeAprProjected(
    apr: number | null,
    clustersEffectiveBalance: string,
    validatorsEffectiveBalance: string
  ): number | null {
    if (apr === null) {
      return null;
    }

    const clusters = Number(clustersEffectiveBalance);
    const validators = Number(validatorsEffectiveBalance);

    if (!Number.isFinite(clusters) || !Number.isFinite(validators)) {
      this.logger.warn('Invalid effective balance data');
      return null;
    }

    if (validators <= 0) {
      this.logger.warn(
        `Invalid validatorsEffectiveBalance: ${validatorsEffectiveBalance}`
      );
      return null;
    }

    const projected = apr * (clusters / validators);

    if (!Number.isFinite(projected)) {
      this.logger.warn(`Calculated projected APR is not finite: ${projected}`);
      return null;
    }

    this.logger.log(`Computed projected APR: ${projected.toFixed(2)}%`);
    return projected;
  }

  private async getProjectedApr(apr: number | null): Promise<number | null> {
    if (apr === null) {
      return null;
    }

    try {
      const [clustersEffectiveBalance, validatorsEffectiveBalance] =
        await Promise.all([
          this.ecService.getClustersEffectiveBalance(),
          this.ecService.getValidatorsEffectiveBalance()
        ]);

      return this.computeAprProjected(
        apr,
        clustersEffectiveBalance,
        validatorsEffectiveBalance
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to compute projected APR: ${message}`);
      return null;
    }
  }

  /**
   * Get the latest APR sample
   */
  async getLatestSample(): Promise<AprSample | null> {
    return await this.aprSampleRepository.findOne({
      order: { timestamp: 'DESC' }
    });
  }

  /**
   * Get the two latest samples for APR display
   */
  async getLatestTwoSamples(): Promise<AprSample[]> {
    return await this.aprSampleRepository.find({
      order: { timestamp: 'DESC' },
      take: 2
    });
  }

  /**
   * Get current APR data for the API
   */
  async getCurrentApr(): Promise<CurrentAprResponse | null> {
    try {
      // Fetch fresh data from blockchain and CoinGecko
      const [accEthPerShare, prices] = await Promise.all([
        this.blockchainService.getAccEthPerShare(),
        this.coinGeckoService.getPrices()
      ]);

      // Compute APR
      const apr = this.computeApr(
        accEthPerShare,
        prices.ethPrice,
        prices.ssvPrice
      );

      const aprProjected = await this.getProjectedApr(apr);

      const lastUpdated = Math.floor(Date.now() / 1000);

      return {
        apr,
        aprProjected,
        lastUpdated
      };
    } catch (error) {
      this.logger.error('Failed to get current APR', error);
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

    return await queryBuilder.getMany();
  }

  /**
   * Clean up old samples (keep last 365 days)
   */
  @Cron(CronExpression.EVERY_WEEK)
  async cleanupOldSamples(): Promise<void> {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const result = await this.aprSampleRepository.delete({
      timestamp: LessThan(oneYearAgo)
    });

    this.logger.log(`Cleaned up ${result.affected} old APR samples`);
  }

  /**
   * Manual trigger for APR collection (for testing)
   */
  async manualCollectSample(): Promise<AprSample> {
    this.logger.log('Manual APR sample collection triggered');
    return await this.collectAprSample();
  }
}
