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
    const startTime = Date.now();
    this.logger.log('=== collectAprSample() started ===');

    try {
      this.logger.log(
        'Fetching accEthPerShare and prices in parallel...'
      );
      const [accEthPerShare, prices] = await Promise.all([
        this.blockchainService.getAccEthPerShare(),
        this.coinGeckoService.getPrices()
      ]);

      this.logger.log(
        `Data fetched. accEthPerShare: ${accEthPerShare.toString()}, ethPrice: ${prices.ethPrice}, ssvPrice: ${prices.ssvPrice}`
      );

      const timestamp = new Date();
      this.logger.debug(`Sample timestamp: ${timestamp.toISOString()}`);

      this.logger.log('Computing APR...');
      const aprResult = await this.computeApr(
        accEthPerShare,
        prices.ethPrice,
        prices.ssvPrice,
        timestamp
      );
      const apr = aprResult.apr;
      this.logger.log(
        `APR computed: ${apr !== null ? apr.toFixed(4) + '%' : 'null'}`
      );

      this.logger.log('Computing projected APR...');
      const aprProjected = await this.getProjectedApr(apr);
      this.logger.log(
        `Projected APR computed: ${aprProjected !== null ? aprProjected.toFixed(4) + '%' : 'null'}`
      );

      this.logger.log('Creating sample entity...');
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

      this.logger.debug(`Sample entity to save: ${JSON.stringify(sample)}`);

      this.logger.log('Saving sample to database...');
      const savedSample = await this.aprSampleRepository.save(sample);

      const elapsed = Date.now() - startTime;
      this.logger.log(
        `=== collectAprSample() completed in ${elapsed}ms. Saved sample id: ${savedSample.id} ===`
      );
      this.logger.log(
        `APR sample collected successfully. APR: ${apr !== null ? apr.toFixed(2) : '--'}%, projected: ${aprProjected !== null ? aprProjected.toFixed(2) : '--'}%`
      );

      return savedSample;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `=== collectAprSample() FAILED after ${elapsed}ms: ${message} ===`
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
    this.logger.debug(
      `computeApr() inputs: accEthPerShare=${accEthPerShare.toString()}, priceEth=${priceEth}, priceSsv=${priceSsv}`
    );

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

    const deltaTimeSeconds = Math.floor(
      (timestamp.getTime() - latestSample.timestamp.getTime()) / 1000
    );
    if (!Number.isFinite(deltaTimeSeconds) || deltaTimeSeconds <= 0) {
      this.logger.warn(
        `computeApr(): invalid deltaTimeSeconds=${deltaTimeSeconds} using current=${timestamp.toISOString()} and previous=${latestSample.timestamp.toISOString()}`
      );
      return { apr: null, deltaIndex: null, deltaTime: null };
    }

    const priceRatio = priceEth / priceSsv;
    this.logger.debug(
      `priceRatio (ETH/SSV): ${priceRatio} (${priceEth} / ${priceSsv})`
    );

    if (deltaIndex > BigInt(Number.MAX_SAFE_INTEGER)) {
      this.logger.warn(
        `computeApr(): deltaIndex exceeds MAX_SAFE_INTEGER; precision may be lost. deltaIndex=${deltaIndex.toString()}`
      );
    }

    const deltaIndexEth = Number(deltaIndex) / 1e18;
    const ratePerSecond = deltaIndexEth / deltaTimeSeconds;
    this.logger.debug(
      `Delta inputs: deltaIndex=${deltaIndex.toString()}, deltaTimeSeconds=${deltaTimeSeconds}, ratePerSecond=${ratePerSecond}`
    );

    const apr = ratePerSecond * SECONDS_PER_YEAR * priceRatio * 100;
    this.logger.debug(
      `APR formula: (${ratePerSecond} * ${SECONDS_PER_YEAR}) * ${priceRatio} * 100 = ${apr}`
    );

    if (!Number.isFinite(apr)) {
      this.logger.warn(
        `Calculated APR is not finite: ${apr}. Inputs were: ratePerSecond=${ratePerSecond}, priceRatio=${priceRatio}`
      );
      return { apr: null, deltaIndex: null, deltaTime: null };
    }

    this.logger.log(`Computed APR: ${apr.toFixed(2)}%`);
    return {
      apr,
      deltaIndex: deltaIndex.toString(),
      deltaTime: deltaTimeSeconds
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
    this.logger.debug(
      `computeAprProjected() inputs: apr=${apr}, clustersEB=${clustersEffectiveBalance}, validatorsEB=${validatorsEffectiveBalance}`
    );

    if (apr === null) {
      this.logger.debug('computeAprProjected(): apr is null, returning null');
      return null;
    }

    const clusters = Number(clustersEffectiveBalance);
    const validators = Number(validatorsEffectiveBalance);

    this.logger.debug(
      `Parsed balances - clusters: ${clusters}, validators: ${validators}`
    );

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
    this.logger.debug(
      `Effective balance ratio (clusters/validators): ${ratio} (${clusters} / ${validators})`
    );

    const projected = apr * ratio;
    this.logger.debug(
      `Projected APR formula: ${apr} * ${ratio} = ${projected}`
    );

    if (!Number.isFinite(projected)) {
      this.logger.warn(
        `Calculated projected APR is not finite: ${projected}. apr=${apr}, ratio=${ratio}`
      );
      return null;
    }

    this.logger.log(`Computed projected APR: ${projected.toFixed(2)}%`);
    return projected;
  }

  private async getProjectedApr(apr: number | null): Promise<number | null> {
    this.logger.log(`getProjectedApr() called with apr=${apr}`);

    if (apr === null) {
      this.logger.warn('getProjectedApr(): apr is null, skipping projected APR calculation');
      return null;
    }

    try {
      this.logger.log('Fetching clusters and validators effective balances in parallel...');
      const [clustersEffectiveBalance, validatorsEffectiveBalance] =
        await Promise.all([
          this.ecService.getClustersEffectiveBalance(),
          this.ecService.getValidatorsEffectiveBalance()
        ]);

      this.logger.log(
        `Effective balances fetched - clusters: ${clustersEffectiveBalance}, validators: ${validatorsEffectiveBalance}`
      );

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
    this.logger.debug('getLatestSample() called');
    const sample = await this.aprSampleRepository.findOne({
      order: { timestamp: 'DESC' }
    });
    this.logger.debug(
      `getLatestSample() result: ${sample ? `id=${sample.id}, timestamp=${sample.timestamp}` : 'null'}`
    );
    return sample;
  }

  /**
   * Get the two latest samples for APR display
   */
  async getLatestTwoSamples(): Promise<AprSample[]> {
    this.logger.debug('getLatestTwoSamples() called');
    const samples = await this.aprSampleRepository.find({
      order: { timestamp: 'DESC' },
      take: 2
    });
    this.logger.debug(`getLatestTwoSamples() returned ${samples.length} samples`);
    return samples;
  }

  /**
   * Get current APR data for the API
   */
  async getCurrentApr(): Promise<CurrentAprResponse | null> {
    const startTime = Date.now();
    this.logger.log('=== getCurrentApr() started ===');

    try {
      this.logger.log('Fetching accEthPerShare and prices in parallel...');
      const [accEthPerShare, prices] = await Promise.all([
        this.blockchainService.getAccEthPerShare(),
        this.coinGeckoService.getPrices()
      ]);

      this.logger.log(
        `Data fetched. accEthPerShare: ${accEthPerShare.toString()}, ethPrice: ${prices.ethPrice}, ssvPrice: ${prices.ssvPrice}`
      );

      this.logger.log('Computing APR...');
      const aprResult = await this.computeApr(
        accEthPerShare,
        prices.ethPrice,
        prices.ssvPrice,
        new Date()
      );
      const apr = aprResult.apr;

      this.logger.log('Computing projected APR...');
      const aprProjected = await this.getProjectedApr(apr);

      const lastUpdated = Math.floor(Date.now() / 1000);
      const elapsed = Date.now() - startTime;

      this.logger.log(
        `=== getCurrentApr() completed in ${elapsed}ms. apr=${apr !== null ? apr.toFixed(2) + '%' : 'null'}, aprProjected=${aprProjected !== null ? aprProjected.toFixed(2) + '%' : 'null'} ===`
      );

      return {
        apr,
        aprProjected,
        lastUpdated
      };
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `=== getCurrentApr() FAILED after ${elapsed}ms: ${message} ===`
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
    this.logger.log(
      `getHistoricalSamples() called. limit=${limit}, startDate=${startDate?.toISOString() || 'none'}, endDate=${endDate?.toISOString() || 'none'}`
    );

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
    this.logger.log(`getHistoricalSamples() returned ${samples.length} samples`);
    return samples;
  }

  /**
   * Clean up old samples (keep last 365 days)
   */
  @Cron(CronExpression.EVERY_WEEK)
  async cleanupOldSamples(): Promise<void> {
    this.logger.log('cleanupOldSamples() started');
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    this.logger.log(`Deleting samples older than: ${oneYearAgo.toISOString()}`);

    const result = await this.aprSampleRepository.delete({
      timestamp: LessThan(oneYearAgo)
    });

    this.logger.log(`Cleaned up ${result.affected} old APR samples`);
  }

  /**
   * Manual trigger for APR collection (for testing)
   */
  async manualCollectSample(): Promise<AprSample> {
    this.logger.log('manualCollectSample() called - manual APR sample collection triggered');
    return await this.collectAprSample();
  }
}
