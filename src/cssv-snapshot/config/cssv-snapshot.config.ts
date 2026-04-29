import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import {
  CSSV_SNAPSHOT_CRON_EXPRESSION,
  CSSV_SNAPSHOT_CRON_TIME_ZONE,
  DEFAULT_LOG_CHUNK_SIZE_BLOCKS,
  EXPECTED_BLOCKS_PER_DAY
} from '../constants/cssv-snapshot.constants';

function parseRequiredPositiveInteger(name: string, value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }

  return Number(value);
}

@Injectable()
export class CssvSnapshotConfigService {
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly viewsContractAddress: string;
  readonly stakingContractAddress: string;
  readonly cssvTokenAddress: string;
  readonly cssvSnapshotStartBlock: number;
  readonly expectedBlocksPerDay: number;
  readonly logChunkSizeBlocks: number;
  readonly cronExpression: string;
  readonly cronTimeZone: string;

  constructor(private readonly configService: ConfigService) {
    this.rpcUrl = this.getRequiredString('ARCHIVE_RPC_URL');
    this.chainId = parseRequiredPositiveInteger(
      'CHAIN_ID',
      this.getRequiredString('CHAIN_ID')
    );
    this.viewsContractAddress = ethers.getAddress(
      this.getRequiredString('VIEWS_CONTRACT_ADDRESS')
    );
    this.stakingContractAddress = ethers.getAddress(
      this.getRequiredString('STAKING_CONTRACT_ADDRESS')
    );
    this.cssvTokenAddress = ethers.getAddress(
      this.getRequiredString('CSSV_TOKEN_ADDRESS')
    );
    this.cssvSnapshotStartBlock = parseRequiredPositiveInteger(
      'CSSV_SNAPSHOT_START_BLOCK',
      this.getRequiredString('CSSV_SNAPSHOT_START_BLOCK')
    );
    this.expectedBlocksPerDay = EXPECTED_BLOCKS_PER_DAY;
    this.logChunkSizeBlocks = this.getOptionalPositiveInteger(
      'LOG_CHUNK_SIZE_BLOCKS',
      DEFAULT_LOG_CHUNK_SIZE_BLOCKS
    );
    this.cronExpression = CSSV_SNAPSHOT_CRON_EXPRESSION;
    this.cronTimeZone = CSSV_SNAPSHOT_CRON_TIME_ZONE;
  }

  private getRequiredString(key: string): string {
    const value = this.configService.get<string>(key);

    if (!value) {
      throw new Error(`${key} must be set when CSSV snapshot module is enabled`);
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
}
