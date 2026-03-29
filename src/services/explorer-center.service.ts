import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseApiService } from './base-api.service';

interface ExplorerCenterClustersEffectiveBalanceResponse {
  totalEffectiveBalance: string;
}

@Injectable()
export class ExplorerCenterService extends BaseApiService {
  constructor(configService: ConfigService) {
    const logger = new Logger(ExplorerCenterService.name);
    const url = configService.getOrThrow<string>('EXPLORER_CENTER_URL');

    logger.log(`ExplorerCenterService configured with base URL: ${url}`);
    super(logger, url, 'Explorer Center effective balance');
  }

  async getClustersEffectiveBalance(): Promise<string> {
    const response =
      await this.get<ExplorerCenterClustersEffectiveBalanceResponse>(
        '/clusters/effective-balance'
      );
    const value = response.totalEffectiveBalance;

    if (typeof value !== 'string') {
      throw new Error(
        `Explorer Center response missing totalEffectiveBalance. Data: ${JSON.stringify(response)}`
      );
    }

    return value;
  }
}
