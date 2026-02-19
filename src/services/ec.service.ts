import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';


interface Cluster {
  clusterId: string;
  effectiveBalance: number;
  hash: string;
}

interface ValidatorsEffectiveBalanceResponse {
  epoch: number;
  referenceBlock: number;
  merkleRoot: string;
  txHash: string;
  clusters: Cluster[];
  layers: string[];
}

interface ClustersEffectiveBalanceResponse {
  totalEffectiveBalance: string;
}

@Injectable()
export class EcService {
  private readonly logger = new Logger(EcService.name);
  private readonly axiosInstance: AxiosInstance;
  private readonly oracleAxiosInstance: AxiosInstance;
  private readonly baseUrl: string;
  private readonly oracleUrl: string;

  constructor(private configService: ConfigService) {
    this.baseUrl =
      this.configService.get<string>('EXPLORER_CENTER_HOODI') || '';
    this.oracleUrl =
      this.configService.get<string>('ORACLE_URL') || '';

    this.logger.log(
      `EcService initialized. EXPLORER_CENTER_HOODI: ${this.baseUrl || 'NOT SET'}, ORACLE_URL: ${this.oracleUrl || 'NOT SET'}`
    );

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000
    });

    this.oracleAxiosInstance = axios.create({
      baseURL: this.oracleUrl,
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
    if (this.baseUrl.includes('EXPLORER_CENTER') || this.oracleUrl.includes('ORACLE_URL')) {
      this.logger.error(
        `EXPLORER_CENTER_HOODI contains placeholder value: "${this.baseUrl}" or ORACLE_URL contains placeholder value: "${this.oracleUrl}". Cannot make EC API calls.`
      );
      throw new Error('EXPLORER_CENTER_HOODI or ORACLE_URL is not configured');
    }
  }

  async getValidatorsEffectiveBalance(): Promise<string> {
    this.ensureConfigured();

    const endpoint = '/api/v1/commit?full=true';
    const startTime = Date.now();

    try {
      const response = await this.oracleAxiosInstance.get<ValidatorsEffectiveBalanceResponse>(endpoint);
      const clusters = response.data?.clusters;

      if (!Array.isArray(clusters)) {
        this.logger.error(
          `Missing or invalid clusters array from Oracle response. Got: ${JSON.stringify(response.data)}`
        );
        throw new Error('Missing clusters array from Oracle');
      }

      const total = clusters.reduce((sum, cluster) => {
        if (typeof cluster.effectiveBalance !== 'number') {
          this.logger.error(
            `Invalid effectiveBalance in cluster: ${JSON.stringify(cluster)}`
          );
          throw new Error('Invalid effectiveBalance in cluster');
        }
        return sum + cluster.effectiveBalance;
      }, 0);

      return total.toString();
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

