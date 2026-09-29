import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface TokenPrices {
  ethPrice: number;
  ssvPrice: number;
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

@Injectable()
export class CoinGeckoService {
  private readonly logger = new Logger(CoinGeckoService.name);
  private readonly axiosInstance: AxiosInstance;
  private readonly baseUrl: string;
  private readonly cacheTtlMs: number;
  private cachedPrices: {
    value: TokenPrices;
    expiresAt: number;
    fetchedAt: number;
  } | null = null;

  constructor(private configService: ConfigService) {
    this.baseUrl =
      this.configService.get<string>('COINGECKO_API_URL') ||
      'https://api.coingecko.com/api/v3';

    this.cacheTtlMs = this.resolveCacheTtlMs();

    const apiKey = this.configService.get<string>('COINGECKO_API_KEY');
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
   * Get current prices for ETH and SSV with in-memory caching.
   * Intended for API request paths that can tolerate slightly stale data
   * in exchange for insulation against CoinGecko rate limits.
   * When CoinGecko fails, the last good prices are served and the cache is
   * re-armed, so a rate limit is not prolonged by retrying on every request.
   */
  async getPrices(): Promise<TokenPrices> {
    const now = Date.now();
    if (this.cachedPrices && this.cachedPrices.expiresAt > now) {
      return this.cachedPrices.value;
    }

    try {
      const prices = await this.getSpotPrices();
      this.storePrices(prices);
      return prices;
    } catch (error) {
      if (!this.cachedPrices) {
        throw error;
      }

      const ageMs = now - this.cachedPrices.fetchedAt;
      this.logger.warn(
        `Serving stale CoinGecko prices (age ${Math.round(ageMs / 1000)}s) after fetch failure`
      );
      this.cachedPrices.expiresAt = now + this.cacheTtlMs;
      return this.cachedPrices.value;
    }
  }

  /**
   * Fetch prices directly from CoinGecko, bypassing and refreshing the cache.
   * Intended for the scheduled sample collection job, which must always record
   * up-to-date values.
   */
  async getPricesFresh(): Promise<TokenPrices> {
    const prices = await this.getSpotPrices();
    this.storePrices(prices);
    return prices;
  }

  private storePrices(prices: TokenPrices): void {
    const now = Date.now();
    this.cachedPrices = {
      value: prices,
      expiresAt: now + this.cacheTtlMs,
      fetchedAt: now
    };
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
