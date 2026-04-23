import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ethers } from 'ethers';
import { CssvSnapshotConfigService } from '../config/cssv-snapshot.config';
import { CSSV_SNAPSHOT_STAKING_MINIMAL_ABI } from '../abis/ssv-staking.abi';
import { CSSV_SNAPSHOT_VIEWS_MINIMAL_ABI } from '../abis/ssv-views.abi';
import { CssvBlockHeader } from '../types/cssv-snapshot.types';

@Injectable()
export class CssvSnapshotBlockchainService implements OnModuleInit {
  private readonly logger = new Logger(CssvSnapshotBlockchainService.name);
  private static readonly PREVIEW_BATCH_SIZE = 100;
  private readonly provider: ethers.JsonRpcProvider;
  private readonly viewsContract: ethers.Contract;

  constructor(private readonly config: CssvSnapshotConfigService) {
    this.provider = new ethers.JsonRpcProvider(
      this.config.rpcUrl,
      this.config.chainId,
      {
        staticNetwork: true,
        batchMaxCount: 100,
        batchStallTime: 20,
        batchMaxSize: 1 << 20 // 1 MB
      }
    );
    this.viewsContract = new ethers.Contract(
      this.config.viewsContractAddress,
      CSSV_SNAPSHOT_VIEWS_MINIMAL_ABI,
      this.provider
    );
  }

  async onModuleInit(): Promise<void> {
    const network = await this.provider.getNetwork();

    this.logger.log(
      `CSSV snapshot blockchain service ready on chainId=${network.chainId.toString()}, cssv=${this.config.cssvTokenAddress}, staking=${this.config.stakingContractAddress}, views=${this.config.viewsContractAddress}`
    );
  }

  getProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }

  async getLatestBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  async getBlockHeader(blockNumber: number): Promise<CssvBlockHeader> {
    const block = await this.provider.getBlock(blockNumber);

    if (!block) {
      throw new Error(`Block ${blockNumber} not found`);
    }

    return {
      number: Number(block.number),
      timestamp: Number(block.timestamp)
    };
  }

  async getLatestBlockHeader(): Promise<CssvBlockHeader> {
    const latestBlockNumber = await this.getLatestBlockNumber();

    return this.getBlockHeader(latestBlockNumber);
  }

  async totalStakedAtBlock(blockNumber: number): Promise<bigint> {
    return this.readViewsBigIntAtBlock('totalStaked', [], blockNumber);
  }

  async previewClaimableEthAtBlock(
    walletAddress: string,
    blockNumber: number
  ): Promise<bigint> {
    return this.readViewsBigIntAtBlock(
      'previewClaimableEth',
      [ethers.getAddress(walletAddress)],
      blockNumber
    );
  }

  async previewClaimableEthBatchAtBlock(
    walletAddresses: Iterable<string>,
    blockNumber: number
  ): Promise<Map<string, bigint>> {
    const normalizedWalletAddresses = [...new Set(
      [...walletAddresses].map((walletAddress) => ethers.getAddress(walletAddress))
    )];
    const previewByWallet = new Map<string, bigint>();

    // Keep concurrent eth_call fanout bounded so one large day does not blast the RPC.
    for (
      let start = 0;
      start < normalizedWalletAddresses.length;
      start += CssvSnapshotBlockchainService.PREVIEW_BATCH_SIZE
    ) {
      const batchWalletAddresses = normalizedWalletAddresses.slice(
        start,
        start + CssvSnapshotBlockchainService.PREVIEW_BATCH_SIZE
      );
      const batchResults = await Promise.all(
        batchWalletAddresses.map(async (walletAddress) => [
          walletAddress,
          await this.previewClaimableEthAtBlock(walletAddress, blockNumber)
        ] as const)
      );

      for (const [walletAddress, previewWei] of batchResults) {
        previewByWallet.set(walletAddress, previewWei);
      }
    }

    return previewByWallet;
  }

  private async readViewsBigIntAtBlock(
    functionName: 'totalStaked' | 'previewClaimableEth',
    args: readonly unknown[],
    blockNumber: number
  ): Promise<bigint> {
    const data = this.viewsContract.interface.encodeFunctionData(
      functionName,
      args
    );
    const rawResult = await this.provider.call(
      {
        to: this.config.viewsContractAddress,
        data,
        blockTag: blockNumber
      },
    );
    const [result] = this.viewsContract.interface.decodeFunctionResult(
      functionName,
      rawResult
    );

    return BigInt(result.toString());
  }
}
