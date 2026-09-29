import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios, { AxiosInstance } from 'axios';
import { Repository } from 'typeorm';
import { AprSample } from '../entities/apr-sample.entity';

export interface TokenPrices {
  ethPrice: number;
  ssvPrice: number;
}

export interface TimedTokenPrices extends TokenPrices {
  /** Epoch ms at which these prices were fetched from CoinGecko. */
  fetchedAt: number;
}

interface CoinGeckoSimplePriceResponse {
  ethereum?: {
    usd?: number;
  };
  'ssv-network'?: {
    usd?: number;
  };
}

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
/** Prices older than this are never served; the API reports failure instead. */
export const MAX_PRICE_STALENESS_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CoinGeckoService {
  private readonly logger = new Logger(CoinGeckoService.name);
  private readonly axiosInstance: AxiosInstance;
  private readonly baseUrl: string;
  private readonly cacheTtlMs: number;
  private cachedPrices: TimedTokenPrices | null = null;
  private cacheExpiresAt = 0;
  private refreshInFlight: Promise<TimedTokenPrices> | null = null;
  private seedAttempted = false;

  constructor(
    private configService: ConfigService,
    @InjectRepository(AprSample)
    private aprSampleRepository: Repository<AprSample>
  ) {
    this.baseUrl =
      this.configService.get<string>('COINGECKO_API_URL') ||
      'https://api.coingecko.com/api/v3';

    this.cacheTtlMs = this.resolveCacheTtlMs();

    const apiKey = this.configService.get<string>('COINGECKO_API_KEY')?.trim();
    // Pro keys only work against pro-api.coingecko.com; everything else uses the demo header.
    const apiKeyHeader = this.baseUrl.includes('pro-api.coingecko.com')
      ? 'x-cg-pro-api-key'
      : 'x-cg-demo-api-key';

    this.logger.log(
      `CoinGeckoService initialized with baseUrl: ${this.baseUrl}, cacheTtlMs: ${this.cacheTtlMs}, apiKey: ${apiKey ? apiKeyHeader : 'none'}`
    );

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: apiKey ? { [apiKeyHeader]: apiKey } : {}
    });
  }

  /**
   * Get current prices for ETH and SSV for API request paths.
   *
   * Serves cached prices while fresh. Once the TTL passes, stale prices are
   * served immediately while a single background refresh runs; a failed
   * refresh re-arms the TTL, so CoinGecko outages and rate limits are not
   * amplified by page traffic. On a cold start the cache is seeded from the
   * latest stored APR sample. Prices older than MAX_PRICE_STALENESS_MS are
   * never served.
   */
  async getPrices(): Promise<TimedTokenPrices> {
    await this.seedFromLatestSample();

    const cached = this.cachedPrices;
    if (cached && this.isServable(cached)) {
      if (this.cacheExpiresAt <= Date.now()) {
        void this.refresh().catch(() => undefined);
      }
      return cached;
    }

    return this.refresh();
  }

  /**
   * Fetch prices directly from CoinGecko, bypassing and refreshing the cache.
   * Intended for the scheduled sample collection job, which must always record
   * up-to-date values. Throws on failure instead of falling back.
   */
  async getPricesFresh(): Promise<TokenPrices> {
    const prices = await this.getSpotPrices();
    this.storePrices(prices);
    return prices;
  }

  /**
   * Fetch from CoinGecko, sharing one request between concurrent callers.
   * Rejects when the fetch fails and no servable cached price exists.
   */
  private refresh(): Promise<TimedTokenPrices> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.getSpotPrices()
        .then((prices) => this.storePrices(prices))
        .catch((error: unknown) => {
          const cached = this.cachedPrices;
          if (!cached || !this.isServable(cached)) {
            throw error;
          }

          this.cacheExpiresAt = Date.now() + this.cacheTtlMs;
          this.logger.warn(
            `Serving stale CoinGecko prices (age ${Math.round((Date.now() - cached.fetchedAt) / 1000)}s) after fetch failure`
          );
          return cached;
        })
        .finally(() => {
          this.refreshInFlight = null;
        });
    }

    return this.refreshInFlight;
  }

  private isServable(prices: TimedTokenPrices): boolean {
    return Date.now() - prices.fetchedAt < MAX_PRICE_STALENESS_MS;
  }

  private storePrices(prices: TokenPrices): TimedTokenPrices {
    const now = Date.now();
    this.cachedPrices = {
      ethPrice: prices.ethPrice,
      ssvPrice: prices.ssvPrice,
      fetchedAt: now
    };
    this.cacheExpiresAt = now + this.cacheTtlMs;
    return this.cachedPrices;
  }

  /**
   * Seed an empty cache with the prices of the latest stored APR sample, so a
   * restart during a CoinGecko outage still serves prices. The seeded entry is
   * marked expired, so the first request also triggers a background refresh.
   */
  private async seedFromLatestSample(): Promise<void> {
    if (this.seedAttempted || this.cachedPrices) {
      return;
    }
    this.seedAttempted = true;

    try {
      const [latest] = await this.aprSampleRepository.find({
        order: { timestamp: 'DESC' },
        take: 1
      });
      if (!latest || this.cachedPrices) {
        return;
      }

      const ethPrice = Number(latest.ethPrice);
      const ssvPrice = Number(latest.ssvPrice);
      if (
        !Number.isFinite(ethPrice) ||
        !Number.isFinite(ssvPrice) ||
        ethPrice <= 0 ||
        ssvPrice <= 0
      ) {
        return;
      }

      this.cachedPrices = {
        ethPrice,
        ssvPrice,
        fetchedAt: latest.timestamp.getTime()
      };
      this.cacheExpiresAt = 0;
      this.logger.log(
        `Seeded CoinGecko price cache from APR sample at ${latest.timestamp.toISOString()}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not seed CoinGecko price cache: ${message}`);
    }
  }

  private resolveCacheTtlMs(): number {
    const raw = this.configService.get<string | number>(
      'COINGECKO_CACHE_TTL_MS'
    );
    if (raw === undefined || raw === null || raw === '') {
      return DEFAULT_CACHE_TTL_MS;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      this.logger.warn(
        `Invalid COINGECKO_CACHE_TTL_MS="${raw}", falling back to ${DEFAULT_CACHE_TTL_MS}`
      );
      return DEFAULT_CACHE_TTL_MS;
    }

    return parsed;
  }

  /**
   * Get current spot prices for ETH and SSV
   */
  private async getSpotPrices(): Promise<TokenPrices> {
    const params = { ids: 'ethereum,ssv-network', vs_currencies: 'usd' };

    const startTime = Date.now();

    try {
      const response =
        await this.axiosInstance.get<CoinGeckoSimplePriceResponse>(
          '/simple/price',
          { params }
        );

      const ethPrice = response.data.ethereum?.usd;
      const ssvPrice = response.data['ssv-network']?.usd;

      if (typeof ethPrice !== 'number' || typeof ssvPrice !== 'number') {
        this.logger.error(
          `Missing price data from CoinGecko. ethPrice type: ${typeof ethPrice}, ssvPrice type: ${typeof ssvPrice}`
        );
        this.logger.error(`Full response: ${JSON.stringify(response.data)}`);
        throw new Error('Missing price data from CoinGecko');
      }

      return { ethPrice, ssvPrice };
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Failed to fetch spot prices after ${elapsed}ms: ${message}`
      );

      if (axios.isAxiosError(error)) {
        this.logger.error(
          `Axios error details - status: ${error.response?.status}, statusText: ${error.response?.statusText}`
        );
        this.logger.error(
          `Response data: ${JSON.stringify(error.response?.data)}`
        );
        this.logger.debug(
          `Request: ${error.config?.method?.toUpperCase()} ${error.config?.baseURL ?? ''}${error.config?.url ?? ''} params=${JSON.stringify(error.config?.params)}`
        );
      }

      if (stack) {
        this.logger.debug(`Stack trace: ${stack}`);
      }

      throw error;
    }
  }
}
