import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseApiService } from './base-api.service';

export interface ExplorerCenterClusterStats {
  totalActiveClusters: number;
  ETHClusters: number;
  SSVclusters: number;
  totalEffectiveBalance: string;
  totalETHEffectiveBalance: string;
}

@Injectable()
export class ExplorerCenterService extends BaseApiService {
  constructor(configService: ConfigService) {
    const logger = new Logger(ExplorerCenterService.name);
    const url = configService.getOrThrow<string>('EXPLORER_CENTER_URL');

    logger.log(`ExplorerCenterService configured with base URL: ${url}`);
    super(logger, url, 'Explorer Center effective balance');
  }

  async getClustersEffectiveBalance(): Promise<ExplorerCenterClusterStats> {
    return await this.get<ExplorerCenterClusterStats>(
      '/clusters/effective-balance'
    );
  }
}
