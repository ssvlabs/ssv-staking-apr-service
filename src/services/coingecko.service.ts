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

@Injectable()
export class CoinGeckoService {
  private readonly logger = new Logger(CoinGeckoService.name);
  private readonly axiosInstance: AxiosInstance;
  private readonly baseUrl: string;

  constructor(private configService: ConfigService) {
    this.baseUrl =
      this.configService.get<string>('COINGECKO_API_URL') ||
      'https://api.coingecko.com/api/v3';

    this.logger.log(`CoinGeckoService initialized with baseUrl: ${this.baseUrl}`);

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000
    });
  }

  /**
   * Get current prices for ETH and SSV (for APR calculation)
   */
  async getPrices(): Promise<TokenPrices> {
    this.logger.log('getPrices() called');
    return this.getSpotPrices();
  }

  /**
   * Get current spot prices for ETH and SSV
   */
  private async getSpotPrices(): Promise<TokenPrices> {
    const requestUrl = `${this.baseUrl}/simple/price`;
    const params = { ids: 'ethereum,ssv-network', vs_currencies: 'usd' };

    this.logger.log(`Fetching spot prices from CoinGecko: GET ${requestUrl}`);
    this.logger.debug(`Request params: ${JSON.stringify(params)}`);

    const startTime = Date.now();

    try {
      const response =
        await this.axiosInstance.get<CoinGeckoSimplePriceResponse>(
          '/simple/price',
          { params }
        );

      const elapsed = Date.now() - startTime;
      this.logger.log(
        `CoinGecko responded in ${elapsed}ms. HTTP status: ${response.status}`
      );
      this.logger.debug(`Response headers: ${JSON.stringify(response.headers)}`);
      this.logger.debug(`Raw response data: ${JSON.stringify(response.data)}`);

      const ethPrice = response.data.ethereum?.usd;
      const ssvPrice = response.data['ssv-network']?.usd;

      this.logger.debug(
        `Parsed prices - ethereum.usd: ${ethPrice}, ssv-network.usd: ${ssvPrice}`
      );

      if (typeof ethPrice !== 'number' || typeof ssvPrice !== 'number') {
        this.logger.error(
          `Missing price data from CoinGecko. ethPrice type: ${typeof ethPrice}, ssvPrice type: ${typeof ssvPrice}`
        );
        this.logger.error(
          `Full response: ${JSON.stringify(response.data)}`
        );
        throw new Error('Missing price data from CoinGecko');
      }

      this.logger.log(`Spot prices - ETH: $${ethPrice}, SSV: $${ssvPrice}`);

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