import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';


interface Cluster {
  clusterId: string;
  effectiveBalance: number;
  hash: string;
}


interface OracleClustersEffectiveBalanceResponse {
  epoch: number;
  referenceBlock: number;
  merkleRoot: string;
  txHash: string;
  clusters: Cluster[];
  layers: string[];
}


interface EcClustersEffectiveBalanceResponse {
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


  async getOracleClustersEffectiveBalance(): Promise<string> {
    this.ensureConfigured();
    const endpoint = '/api/v1/commit?full=true';
    const startTime = Date.now();
    try {
      const response = await this.oracleAxiosInstance.get<OracleClustersEffectiveBalanceResponse>(endpoint);
      const clusters = response.data?.clusters;
      if (!Array.isArray(clusters)) {
        const msg = `Oracle response missing clusters array. Data: ${JSON.stringify(response.data)}`;
        this.logger.error(msg);
        throw new Error(msg);
      }
      const total = clusters.reduce((sum, cluster) => {
        if (typeof cluster.effectiveBalance !== 'number') {
          const msg = `Oracle cluster missing/invalid effectiveBalance: ${JSON.stringify(cluster)}`;
          this.logger.error(msg);
          throw new Error(msg);
        }
        return sum + cluster.effectiveBalance;
      }, 0);
      return total.toString();
    } catch (error) {
      const elapsed = Date.now() - startTime;
      let details = '';
      if (axios.isAxiosError(error)) {
        details = `AxiosError: status=${error.response?.status}, statusText=${error.response?.statusText}, url=${error.config?.url}, baseURL=${error.config?.baseURL}, response=${JSON.stringify(error.response?.data)}`;
      } else if (error instanceof Error) {
        details = error.stack || error.message;
      } else {
        details = String(error);
      }
      this.logger.error(`Failed to fetch Oracle clusters effective balance after ${elapsed}ms. Details: ${details}`);
      throw new Error(`Failed to fetch Oracle clusters effective balance: ${details}`);
    }
  }


  async getEcClustersEffectiveBalance(): Promise<string> {
    this.ensureConfigured();
    const endpoint = '/clusters/effective-balance';
    const startTime = Date.now();
    try {
      const response = await this.axiosInstance.get<EcClustersEffectiveBalanceResponse>(endpoint);
      const value = response.data?.totalEffectiveBalance;
      if (typeof value !== 'string') {
        const msg = `EC response missing totalEffectiveBalance. Data: ${JSON.stringify(response.data)}`;
        this.logger.error(msg);
        throw new Error(msg);
      }
      return value;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      let details = '';
      if (axios.isAxiosError(error)) {
        details = `AxiosError: status=${error.response?.status}, statusText=${error.response?.statusText}, url=${error.config?.url}, baseURL=${error.config?.baseURL}, response=${JSON.stringify(error.response?.data)}`;
      } else if (error instanceof Error) {
        details = error.stack || error.message;
      } else {
        details = String(error);
      }
      this.logger.error(`Failed to fetch EC clusters effective balance after ${elapsed}ms. Details: ${details}`);
      throw new Error(`Failed to fetch EC clusters effective balance: ${details}`);
    }
  }
}

