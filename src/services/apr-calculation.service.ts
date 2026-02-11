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
  ) {
    this.logger.log('AprCalculationService constructed');
  }

  private parseWeiFromNumeric(value: string): bigint {
    const trimmed = value.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
      throw new Error(`Invalid numeric value: "${value}"`);
    }

    const [whole, fraction = ''] = trimmed.split('.');
    if (fraction.length > 0 && /[^0]/.test(fraction)) {
      this.logger.warn(
        `Fractional wei detected in accEthPerShare, truncating: "${value}"`
      );
    }

    return BigInt(whole);
  }

  /**
   * Scheduled job to collect APR sample every 24 hours
   * Default cron: 0 0 * * * (every day at midnight UTC)
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async collectAprSample(): Promise<AprSample> {
    try {
      const [accEthPerShare, prices] = await Promise.all([
        this.blockchainService.getAccEthPerShare(),
        this.coinGeckoService.getPrices()
      ]);

      const timestamp = new Date();

      const aprResult = await this.computeApr(
        accEthPerShare,
        prices.ethPrice,
        prices.ssvPrice,
        timestamp
      );
      const apr = aprResult.apr;

      const aprProjected = await this.getProjectedApr(apr);

      const sample = this.aprSampleRepository.create({
        timestamp,
        accEthPerShare: accEthPerShare.toString(),
        ethPrice: prices.ethPrice.toString(),
        ssvPrice: prices.ssvPrice.toString(),
        currentApr: apr !== null ? apr.toFixed(2) : null,
        aprProjected: aprProjected !== null ? aprProjected.toFixed(2) : null,
        deltaIndex: aprResult.deltaIndex,
        deltaTime: aprResult.deltaTime
      });

      const savedSample = await this.aprSampleRepository.save(sample);


      return savedSample;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `=== collectAprSample() FAILED: ${message} ===`
      );
      if (stack) {
        this.logger.error(`Stack trace: ${stack}`);
      }
      throw error;
    }
  }

  /**
   * Compute APR from accEthPerShare and token prices
   * Formula:
   * APR = ((ΔIndex / (1e18 × ΔTime)) × SECONDS_PER_YEAR) × (priceEth / priceSsv) × 100
   */
  private async computeApr(
    accEthPerShare: bigint,
    priceEth: number,
    priceSsv: number,
    timestamp: Date
  ): Promise<{
    apr: number | null;
    deltaIndex: string | null;
    deltaTime: number | null;
  }> {
    if (!Number.isFinite(priceEth) || !Number.isFinite(priceSsv)) {
      this.logger.warn(
        `Invalid price data. priceEth=${priceEth} (isFinite: ${Number.isFinite(priceEth)}), priceSsv=${priceSsv} (isFinite: ${Number.isFinite(priceSsv)})`
      );
      return { apr: null, deltaIndex: null, deltaTime: null };
    }

    if (priceEth <= 0 || priceSsv <= 0) {
      this.logger.warn(
        `Non-positive price data. priceEth=${priceEth}, priceSsv=${priceSsv}`
      );
    }

    const latestSample = await this.getLatestSample();
    if (!latestSample) {
      this.logger.warn(
        'computeApr(): no previous sample found, cannot compute delta-based APR'
      );
      return { apr: null, deltaIndex: null, deltaTime: null };
    }

    let previousIndex: bigint;
    try {
      previousIndex = this.parseWeiFromNumeric(latestSample.accEthPerShare);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `computeApr(): failed to parse previous accEthPerShare "${latestSample.accEthPerShare}": ${message}`
      );
      return { apr: null, deltaIndex: null, deltaTime: null };
    }

    const deltaIndex = accEthPerShare - previousIndex;
    if (deltaIndex <= 0n) {
      this.logger.warn(
        `computeApr(): non-positive deltaIndex (${deltaIndex.toString()}) using current=${accEthPerShare.toString()} and previous=${previousIndex.toString()}`
      );
      return { apr: null, deltaIndex: null, deltaTime: null };
    }

    const deltaTimeMs =
      timestamp.getTime() - latestSample.timestamp.getTime();
    if (!Number.isFinite(deltaTimeMs) || deltaTimeMs <= 0) {
      return { apr: null, deltaIndex: null, deltaTime: null };
    }

    const deltaTimeSeconds = deltaTimeMs / 1000;

    const priceRatio = priceEth / priceSsv;

    if (deltaIndex > BigInt(Number.MAX_SAFE_INTEGER)) {
      this.logger.warn(
        `computeApr(): deltaIndex exceeds MAX_SAFE_INTEGER; precision may be lost. deltaIndex=${deltaIndex.toString()}`
      );
    }

    const deltaIndexEth = Number(deltaIndex) / 1e18;
    const ratePerSecond = deltaIndexEth / deltaTimeSeconds;

    const apr = ratePerSecond * SECONDS_PER_YEAR * priceRatio * 100;

    if (!Number.isFinite(apr)) {
      this.logger.warn(
        `Calculated APR is not finite: ${apr}. Inputs were: ratePerSecond=${ratePerSecond}, priceRatio=${priceRatio}`
      );
      return { apr: null, deltaIndex: null, deltaTime: null };
    }

    return {
      apr,
      deltaIndex: deltaIndex.toString(),
      deltaTime: deltaTimeMs
    };
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
      this.logger.warn('computeAprProjected(): apr is null, returning null');
      return null;
    }

    const clusters = Number(clustersEffectiveBalance);
    const validators = Number(validatorsEffectiveBalance);

    if (!Number.isFinite(clusters) || !Number.isFinite(validators)) {
      this.logger.warn(
        `Invalid effective balance data. clusters=${clusters} (isFinite: ${Number.isFinite(clusters)}), validators=${validators} (isFinite: ${Number.isFinite(validators)})`
      );
      return null;
    }

    if (validators <= 0) {
      this.logger.warn(
        `Invalid validatorsEffectiveBalance: ${validatorsEffectiveBalance} -> parsed: ${validators}`
      );
      return null;
    }

    const ratio = clusters / validators;

    const projected = apr * ratio;

    if (!Number.isFinite(projected)) {
      this.logger.warn(
        `Calculated projected APR is not finite: ${projected}. apr=${apr}, ratio=${ratio}`
      );
      return null;
    }

    return projected;
  }

  private async getProjectedApr(apr: number | null): Promise<number | null> {
    if (apr === null) {
      this.logger.warn('getProjectedApr(): apr is null, skipping projected APR calculation');
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
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.warn(`Failed to compute projected APR: ${message}`);
      if (stack) {
        this.logger.debug(`Stack trace: ${stack}`);
      }
      return null;
    }
  }

  /**
   * Get the latest APR sample
   */
  async getLatestSample(): Promise<AprSample | null> {
    const sample = await this.aprSampleRepository.findOne({
      order: { timestamp: 'DESC' }
    });
    return sample;
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
    const startTime = Date.now();

    try {
      const [accEthPerShare, prices] = await Promise.all([
        this.blockchainService.getAccEthPerShare(),
        this.coinGeckoService.getPrices()
      ]);

      const aprResult = await this.computeApr(
        accEthPerShare,
        prices.ethPrice,
        prices.ssvPrice,
        new Date()
      );
      const apr = aprResult.apr;

      const aprProjected = await this.getProjectedApr(apr);

      const lastUpdated = Date.now();

      return {
        apr,
        aprProjected,
        lastUpdated
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `=== getCurrentApr() FAILED: ${message} ===`
      );
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

    const result = await this.aprSampleRepository.delete({
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
