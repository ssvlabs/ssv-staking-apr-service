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

  async getValidatorsEffectiveBalance(): Promise<string> {
    this.logger.log('getValidatorsEffectiveBalance() called');
    this.ensureConfigured();

    const endpoint = '/validators/effective-balance';
    this.logger.log(`Fetching validators effective balance: GET ${this.baseUrl}${endpoint}`);

    const startTime = Date.now();

    try {
      const response =
        await this.axiosInstance.get<ValidatorsEffectiveBalanceResponse>(
          endpoint
        );

      const elapsed = Date.now() - startTime;
      this.logger.log(
        `EC validators endpoint responded in ${elapsed}ms. HTTP status: ${response.status}`
      );
      this.logger.debug(`Raw response data: ${JSON.stringify(response.data)}`);

      const value = response.data?.total_effective_balance;

      this.logger.debug(`total_effective_balance: ${value} (type: ${typeof value})`);

      if (typeof value !== 'string') {
        this.logger.error(
          `Missing total_effective_balance from EC response. Got: ${JSON.stringify(response.data)}`
        );
        throw new Error('Missing total_effective_balance from EC');
      }

      this.logger.log(`Validators effective balance: ${value}`);
      return value;
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
    this.logger.log('getClustersEffectiveBalance() called');
    this.ensureConfigured();

    const endpoint = '/clusters/effective-balance';
    this.logger.log(`Fetching clusters effective balance: GET ${this.baseUrl}${endpoint}`);

    const startTime = Date.now();

    try {
      const response =
        await this.axiosInstance.get<ClustersEffectiveBalanceResponse>(
          endpoint
        );

      const elapsed = Date.now() - startTime;
      this.logger.log(
        `EC clusters endpoint responded in ${elapsed}ms. HTTP status: ${response.status}`
      );
      this.logger.debug(`Raw response data: ${JSON.stringify(response.data)}`);

      const value = response.data?.totalEffectiveBalance;

      this.logger.debug(`totalEffectiveBalance: ${value} (type: ${typeof value})`);

      if (typeof value !== 'string') {
        this.logger.error(
          `Missing totalEffectiveBalance from EC response. Got: ${JSON.stringify(response.data)}`
        );
        throw new Error('Missing totalEffectiveBalance from EC');
      }

      this.logger.log(`Clusters effective balance: ${value}`);
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