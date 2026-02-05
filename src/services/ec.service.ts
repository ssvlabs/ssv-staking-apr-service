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
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000
    });
  }

  private ensureConfigured(): void {
    if (!this.baseUrl || this.baseUrl.includes('EXPLORER_CENTER')) {
      throw new Error('EXPLORER_CENTER_HOODI is not configured');
    }
  }

  async getValidatorsEffectiveBalance(): Promise<string> {
    this.ensureConfigured();
    this.logger.log('Fetching validators effective balance');

    const response =
      await this.axiosInstance.get<ValidatorsEffectiveBalanceResponse>(
        '/validators/effective-balance'
      );

    const value = response.data?.total_effective_balance;
    if (typeof value !== 'string') {
      throw new Error('Missing total_effective_balance from EC');
    }

    return value;
  }

  async getClustersEffectiveBalance(): Promise<string> {
    this.ensureConfigured();
    this.logger.log('Fetching clusters effective balance');

    const response =
      await this.axiosInstance.get<ClustersEffectiveBalanceResponse>(
        '/clusters/effective-balance'
      );

    const value = response.data?.totalEffectiveBalance;
    if (typeof value !== 'string') {
      throw new Error('Missing totalEffectiveBalance from EC');
    }

    return value;
  }
}
