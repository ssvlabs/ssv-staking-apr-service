import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
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
  private axiosInstance: AxiosInstance;
  /** Keyless client used when CoinGecko rejects the configured key; null without a key. */
  private keylessAxiosInstance: AxiosInstance | null = null;
  private readonly baseUrl: string;
  private readonly cacheTtlMs: number;
  private cachedPrices: TimedTokenPrices | null = null;
  private cacheExpiresAt = 0;
  private refreshInFlight: Promise<TimedTokenPrices> | null = null;
  /** Error of the last failed refresh while no servable price existed; rethrown until the TTL passes. */
  private lastRefreshError: Error | null = null;
  private seedDone = false;
  private seedInFlight: Promise<void> | null = null;

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
    if (apiKey) {
      this.keylessAxiosInstance = axios.create({
        baseURL: this.baseUrl,
        timeout: 30000
      });
    }
  }

  /**
   * Get current prices for ETH and SSV for API request paths.
   *
   * Serves cached prices while fresh. Once the TTL passes, stale prices are
   * served immediately while a single background refresh runs; a failed
   * refresh re-arms the TTL, so CoinGecko outages and rate limits are not
   * amplified by page traffic. On a cold start the cache is seeded from the
   * latest stored APR sample. Prices older than MAX_PRICE_STALENESS_MS are
   * never served; without a servable price, a failure is rethrown until the
   * TTL passes instead of calling CoinGecko on every request.
   */
  async getPrices(): Promise<TimedTokenPrices> {
    await this.ensureSeeded();

    const cached = this.cachedPrices;
    if (cached && this.isServable(cached)) {
      if (this.cacheExpiresAt <= Date.now()) {
        void this.refresh().catch(() => undefined);
      }
      return cached;
    }

    if (this.lastRefreshError !== null && this.cacheExpiresAt > Date.now()) {
      throw this.lastRefreshError;
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
          this.cacheExpiresAt = Date.now() + this.cacheTtlMs;
          const cached = this.cachedPrices;
          if (!cached || !this.isServable(cached)) {
            this.lastRefreshError =
              error instanceof Error ? error : new Error(String(error));
            throw error;
          }

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
    this.lastRefreshError = null;
    return this.cachedPrices;
  }

  /**
   * Seed once, sharing the lookup between concurrent cold callers. A failed
   * lookup (e.g. the DB is not ready yet) is retried on the next request.
   */
  private async ensureSeeded(): Promise<void> {
    if (this.seedDone || this.cachedPrices) {
      return;
    }

    if (!this.seedInFlight) {
      this.seedInFlight = this.seedFromLatestSample()
        .then(() => {
          this.seedDone = true;
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(`Could not seed CoinGecko price cache: ${message}`);
        })
        .finally(() => {
          this.seedInFlight = null;
        });
    }

    await this.seedInFlight;
  }

  /**
   * Seed an empty cache with the prices of the latest stored APR sample, so a
   * restart during a CoinGecko outage still serves prices. The seeded entry is
   * marked expired, so the first request also triggers a background refresh.
   */
  private async seedFromLatestSample(): Promise<void> {
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
   * Request /simple/price. If CoinGecko rejects the configured key (400/401)
   * and the keyless API answers, switch to keyless for the rest of the process.
   */
  private async requestSimplePrice(
    params: Record<string, string>
  ): Promise<AxiosResponse<CoinGeckoSimplePriceResponse>> {
    try {
      return await this.axiosInstance.get<CoinGeckoSimplePriceResponse>(
        '/simple/price',
        { params }
      );
    } catch (error) {
      const keyless = this.keylessAxiosInstance;
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      if (!keyless || (status !== 400 && status !== 401)) {
        throw error;
      }

      this.logger.error(
        `CoinGecko rejected COINGECKO_API_KEY (status ${status}); retrying without a key`
      );
      const response = await keyless.get<CoinGeckoSimplePriceResponse>(
        '/simple/price',
        { params }
      );
      this.logger.error(
        'Using the keyless CoinGecko API until restart; fix or remove COINGECKO_API_KEY'
      );
      this.axiosInstance = keyless;
      this.keylessAxiosInstance = null;
      return response;
    }
  }

  /**
   * Get current spot prices for ETH and SSV
   */
  private async getSpotPrices(): Promise<TokenPrices> {
    const params = { ids: 'ethereum,ssv-network', vs_currencies: 'usd' };

    const startTime = Date.now();

    try {
      const response = await this.requestSimplePrice(params);

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
