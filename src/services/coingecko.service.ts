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
  private cachedPrices: { value: TokenPrices; expiresAt: number } | null = null;

  constructor(private configService: ConfigService) {
    this.baseUrl =
      this.configService.get<string>('COINGECKO_API_URL') ||
      'https://api.coingecko.com/api/v3';

    this.cacheTtlMs = this.resolveCacheTtlMs();

    this.logger.log(
      `CoinGeckoService initialized with baseUrl: ${this.baseUrl}, cacheTtlMs: ${this.cacheTtlMs}`
    );

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000
    });
  }

  /**
   * Get current prices for ETH and SSV with in-memory caching.
   * Intended for API request paths that can tolerate slightly stale data
   * in exchange for insulation against CoinGecko rate limits.
   */
  async getPrices(): Promise<TokenPrices> {
    const now = Date.now();
    if (this.cachedPrices && this.cachedPrices.expiresAt > now) {
      return this.cachedPrices.value;
    }

    const prices = await this.getSpotPrices();
    this.cachedPrices = { value: prices, expiresAt: now + this.cacheTtlMs };
    return prices;
  }

  /**
   * Fetch prices directly from CoinGecko, bypassing and refreshing the cache.
   * Intended for the scheduled sample collection job, which must always record
   * up-to-date values.
   */
  async getPricesFresh(): Promise<TokenPrices> {
    const prices = await this.getSpotPrices();
    this.cachedPrices = { value: prices, expiresAt: Date.now() + this.cacheTtlMs };
    return prices;
  }

  private resolveCacheTtlMs(): number {
    const raw = this.configService.get<string | number>('COINGECKO_CACHE_TTL_MS');
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
        this.logger.debug(`Request config: ${JSON.stringify(error.config)}`);
      }

      if (stack) {
        this.logger.debug(`Stack trace: ${stack}`);
      }

      throw error;
    }
  }
}
