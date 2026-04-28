import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseApiService } from './base-api.service';

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

@Injectable()
export class OracleService extends BaseApiService {
  constructor(configService: ConfigService) {
    const logger = new Logger(OracleService.name);
    const url = configService.getOrThrow<string>('ORACLE_URL');

    logger.log(`OracleService configured with base URL: ${url}`);
    super(logger, url, 'Oracle effective balance');
  }

  async getClustersEffectiveBalance(): Promise<string> {
    const response = await this.get<OracleClustersEffectiveBalanceResponse>(
      '/api/v1/commit?full=true'
    );
    const clusters = response.clusters;

    if (!Array.isArray(clusters)) {
      throw new Error(
        `Oracle response missing clusters array. Data: ${JSON.stringify(response)}`
      );
    }

    const total = clusters.reduce((sum, cluster) => {
      if (typeof cluster.effectiveBalance !== 'number') {
        throw new Error(
          `Oracle cluster missing/invalid effectiveBalance: ${JSON.stringify(cluster)}`
        );
      }

      return sum + cluster.effectiveBalance;
    }, 0);

    return total.toString();
  }
}
