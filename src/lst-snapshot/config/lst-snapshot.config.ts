import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import {
  DEFAULT_LST_LOG_CHUNK_SIZE_BLOCKS,
  LST_SNAPSHOT_CRON_EXPRESSION,
  LST_SNAPSHOT_CRON_TIME_ZONE
} from '../constants/lst-snapshot.constants';

function parseRequiredPositiveInteger(name: string, value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }

  return Number(value);
}

@Injectable()
export class LstSnapshotConfigService {
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly logChunkSizeBlocks: number;
  readonly cronExpression: string;
  readonly cronTimeZone: string;
  /** Pinned block for the Jun 5 campaign eligibility snapshot. When set,
   *  the eligibility API queries this exact block and the orchestrator
   *  treats it as the canonical snapshot regardless of test runs. */
  readonly campaignBlock: number | null;
  /** Optional API key required on admin endpoints. When unset all admin
   *  routes are open — intended only for local dev. */
  readonly adminApiKey: string | null;

  constructor(private readonly configService: ConfigService) {
    this.rpcUrl = this.getRequiredString('ARCHIVE_RPC_URL');
    this.chainId = parseRequiredPositiveInteger(
      'CHAIN_ID',
      this.getRequiredString('CHAIN_ID')
    );
    this.logChunkSizeBlocks = this.getOptionalPositiveInteger(
      'LOG_CHUNK_SIZE_BLOCKS',
      DEFAULT_LST_LOG_CHUNK_SIZE_BLOCKS
    );
    this.cronExpression = LST_SNAPSHOT_CRON_EXPRESSION;
    this.cronTimeZone = LST_SNAPSHOT_CRON_TIME_ZONE;
    const campaignBlockRaw = this.configService.get<string>('LST_SNAPSHOT_CAMPAIGN_BLOCK');
    this.campaignBlock = campaignBlockRaw
      ? parseRequiredPositiveInteger('LST_SNAPSHOT_CAMPAIGN_BLOCK', campaignBlockRaw)
      : null;
    this.adminApiKey = this.configService.get<string>('LST_ADMIN_API_KEY') ?? null;
  }

  private getRequiredString(key: string): string {
    const value = this.configService.get<string>(key);

    if (!value) {
      throw new Error(`${key} must be set when LST snapshot module is enabled`);
    }

    return value;
  }

  private getOptionalPositiveInteger(key: string, fallback: number): number {
    const value = this.configService.get<string>(key);

    if (!value) {
      return fallback;
    }

    return parseRequiredPositiveInteger(key, value);
  }

  normalizeAddress(address: string): string {
    return ethers.getAddress(address);
  }
}
