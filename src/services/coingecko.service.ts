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
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000
    });
  }

  /**
   * Get current prices for ETH and SSV (for APR calculation)
   */
  async getPrices(): Promise<TokenPrices> {
    return this.getSpotPrices();
  }

  /**
   * Get current spot prices for ETH and SSV
   */
  private async getSpotPrices(): Promise<TokenPrices> {
    try {
      this.logger.log('Fetching spot prices from CoinGecko');

      const response =
        await this.axiosInstance.get<CoinGeckoSimplePriceResponse>(
          '/simple/price',
          {
            params: {
              ids: 'ethereum,ssv-network',
              vs_currencies: 'usd'
            }
          }
        );

      const ethPrice = response.data.ethereum?.usd;
      const ssvPrice = response.data['ssv-network']?.usd;

      if (typeof ethPrice !== 'number' || typeof ssvPrice !== 'number') {
        throw new Error('Missing price data from CoinGecko');
      }

      this.logger.log(`Spot prices - ETH: $${ethPrice}, SSV: $${ssvPrice}`);

      return { ethPrice, ssvPrice };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to fetch spot prices', message);
      throw error;
    }
  }
}
