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
