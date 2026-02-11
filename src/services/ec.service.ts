import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

interface ValidatorsEffectiveBalanceResponse {
  total_effective_balance: string;
}

interface ClustersEffectiveBalanceResponse {
  totalEffectiveBalance: string;
}

@Injectable()
export class EcService {
  private readonly logger = new Logger(EcService.name);
  private readonly axiosInstance: AxiosInstance;
  private readonly baseUrl: string;

  constructor(private configService: ConfigService) {
    this.baseUrl =
      this.configService.get<string>('EXPLORER_CENTER_HOODI') || '';

    this.logger.log(
      `EcService initialized. EXPLORER_CENTER_HOODI: ${this.baseUrl || 'NOT SET'}`
    );

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000
    });
  }

  private ensureConfigured(): void {
    if (!this.baseUrl) {
      this.logger.error(
        'EXPLORER_CENTER_HOODI env variable is not set. Cannot make EC API calls.'
      );
      throw new Error('EXPLORER_CENTER_HOODI is not configured');
    }
    if (this.baseUrl.includes('EXPLORER_CENTER')) {
      this.logger.error(
        `EXPLORER_CENTER_HOODI contains placeholder value: "${this.baseUrl}". Cannot make EC API calls.`
      );
      throw new Error('EXPLORER_CENTER_HOODI is not configured');
    }
  }

  private gweiToEthString(value: string): string {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`Invalid gwei value: "${value}"`);
    }

    const gwei = BigInt(trimmed);
    const base = 1_000_000_000n;
    const whole = gwei / base;
    const fraction = gwei % base;

    if (fraction === 0n) {
      return whole.toString();
    }

    const fractionStr = fraction
      .toString()
      .padStart(9, '0')
      .replace(/0+$/, '');

    return `${whole.toString()}.${fractionStr}`;
  }

  async getValidatorsEffectiveBalance(): Promise<string> {
    this.ensureConfigured();

    const endpoint = '/validators/effective-balance';

    const startTime = Date.now();

    try {
      const response =
        await this.axiosInstance.get<ValidatorsEffectiveBalanceResponse>(
          endpoint
        );

      const value = response.data?.total_effective_balance;

      if (typeof value !== 'string') {
        this.logger.error(
          `Missing total_effective_balance from EC response. Got: ${JSON.stringify(response.data)}`
        );
        throw new Error('Missing total_effective_balance from EC');
      }

      const ethValue = this.gweiToEthString(value);
      return ethValue;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Failed to fetch validators effective balance after ${elapsed}ms: ${message}`
      );

      if (axios.isAxiosError(error)) {
        this.logger.error(
          `Axios error - status: ${error.response?.status}, statusText: ${error.response?.statusText}`
        );
        this.logger.error(
          `Response data: ${JSON.stringify(error.response?.data)}`
        );
        this.logger.debug(`Request config URL: ${error.config?.url}`);
        this.logger.debug(`Request baseURL: ${error.config?.baseURL}`);
      }

      if (stack) {
        this.logger.debug(`Stack trace: ${stack}`);
      }

      throw error;
    }
  }

  async getClustersEffectiveBalance(): Promise<string> {
    this.ensureConfigured();

    const endpoint = '/clusters/effective-balance';

    const startTime = Date.now();

    try {
      const response =
        await this.axiosInstance.get<ClustersEffectiveBalanceResponse>(
          endpoint
        );

      const value = response.data?.totalEffectiveBalance;

      if (typeof value !== 'string') {
        this.logger.error(
          `Missing totalEffectiveBalance from EC response. Got: ${JSON.stringify(response.data)}`
        );
        throw new Error('Missing totalEffectiveBalance from EC');
      }

      return value;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Failed to fetch clusters effective balance after ${elapsed}ms: ${message}`
      );

      if (axios.isAxiosError(error)) {
        this.logger.error(
          `Axios error - status: ${error.response?.status}, statusText: ${error.response?.statusText}`
        );
        this.logger.error(
          `Response data: ${JSON.stringify(error.response?.data)}`
        );
        this.logger.debug(`Request config URL: ${error.config?.url}`);
        this.logger.debug(`Request baseURL: ${error.config?.baseURL}`);
      }

      if (stack) {
        this.logger.debug(`Stack trace: ${stack}`);
      }

      throw error;
    }
  }
}
