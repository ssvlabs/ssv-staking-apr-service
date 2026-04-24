import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { inspect } from 'node:util';
import { ethers } from 'ethers';
import { CSSV_TOKEN_MINIMAL_ABI } from '../abis/cssv-token.abi';
import { CssvSnapshotConfigService } from '../config/cssv-snapshot.config';
import { CSSV_SNAPSHOT_VIEWS_MINIMAL_ABI } from '../abis/ssv-views.abi';
import {
  CSSV_SNAPSHOT_RPC_MAX_RETRIES,
  CSSV_SNAPSHOT_RPC_RETRY_BASE_DELAY_MS
} from '../constants/cssv-snapshot.constants';
import { CssvBlockHeader } from '../types/cssv-snapshot.types';

@Injectable()
export class CssvSnapshotBlockchainService implements OnModuleInit {
  private readonly logger = new Logger(CssvSnapshotBlockchainService.name);
  private static readonly PREVIEW_BATCH_SIZE = 100;
  private readonly provider: ethers.JsonRpcProvider;
  private readonly cssvTokenContract: ethers.Contract;
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
    this.cssvTokenContract = new ethers.Contract(
      this.config.cssvTokenAddress,
      CSSV_TOKEN_MINIMAL_ABI,
      this.provider
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
    return this.runRpcRequestWithRetry('eth_blockNumber', () =>
      this.provider.getBlockNumber()
    );
  }

  async getBlockHeader(blockNumber: number): Promise<CssvBlockHeader> {
    const block = await this.runRpcRequestWithRetry(
      `eth_getBlockByNumber(${blockNumber})`,
      () => this.provider.getBlock(blockNumber)
    );

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
    return this.runRpcRequestWithRetry(
      `eth_call totalStaked@${blockNumber}`,
      () => this.readViewsBigIntAtBlockOnce('totalStaked', [], blockNumber)
    );
  }

  async previewClaimableEthAtBlock(
    walletAddress: string,
    blockNumber: number
  ): Promise<bigint> {
    const normalizedWalletAddress = ethers.getAddress(walletAddress);

    return this.runRpcRequestWithRetry(
      `eth_call previewClaimableEth(${normalizedWalletAddress})@${blockNumber}`,
      () =>
        this.readViewsBigIntAtBlockOnce(
          'previewClaimableEth',
          [normalizedWalletAddress],
          blockNumber
        )
    );
  }

  async previewClaimableEthBatchAtBlock(
    walletAddresses: Iterable<string>,
    blockNumber: number
  ): Promise<Map<string, bigint>> {
    const normalizedWalletAddresses = this.normalizeWalletAddressSet(walletAddresses);

    return this.readWalletBatchWithRetry(
      normalizedWalletAddresses,
      `previewClaimableEth@${blockNumber}`,
      (walletAddress) =>
        this.readViewsBigIntAtBlockOnce(
          'previewClaimableEth',
          [walletAddress],
          blockNumber
        )
    );
  }

  async balanceWeiSsvAtBlock(
    walletAddress: string,
    blockNumber: number
  ): Promise<bigint> {
    const normalizedWalletAddress = ethers.getAddress(walletAddress);

    return this.runRpcRequestWithRetry(
      `eth_call balanceOf(${normalizedWalletAddress})@${blockNumber}`,
      () =>
        this.readTokenBigIntAtBlockOnce(
          'balanceOf',
          [normalizedWalletAddress],
          blockNumber
        )
    );
  }

  async balanceWeiSsvBatchAtBlock(
    walletAddresses: Iterable<string>,
    blockNumber: number
  ): Promise<Map<string, bigint>> {
    const normalizedWalletAddresses = this.normalizeWalletAddressSet(walletAddresses);

    return this.readWalletBatchWithRetry(
      normalizedWalletAddresses,
      `balanceOf@${blockNumber}`,
      (walletAddress) =>
        this.readTokenBigIntAtBlockOnce(
          'balanceOf',
          [walletAddress],
          blockNumber
        )
    );
  }

  async runRpcRequestWithRetry<T>(
    description: string,
    operation: () => Promise<T>
  ): Promise<T> {
    let retryCount = 0;

    while (true) {
      try {
        return await operation();
      } catch (error) {
        if (
          !this.isRetryableRpcError(error) ||
          retryCount >= CSSV_SNAPSHOT_RPC_MAX_RETRIES
        ) {
          throw error;
        }

        retryCount += 1;
        const delayMs =
          CSSV_SNAPSHOT_RPC_RETRY_BASE_DELAY_MS * 2 ** (retryCount - 1);

        this.logger.warn(
          `Transient CSSV snapshot RPC failure during ${description}; ` +
            `retry ${retryCount}/${CSSV_SNAPSHOT_RPC_MAX_RETRIES} in ${delayMs}ms: ` +
            this.formatRpcError(error)
        );

        await this.sleep(delayMs);
      }
    }
  }

  private async readViewsBigIntAtBlockOnce(
    functionName: 'totalStaked' | 'previewClaimableEth',
    args: readonly unknown[],
    blockNumber: number
  ): Promise<bigint> {
    const data = this.viewsContract.interface.encodeFunctionData(
      functionName,
      args
    );
    const rawResult = await this.provider.call({
      to: this.config.viewsContractAddress,
      data,
      blockTag: blockNumber
    });
    const [result] = this.viewsContract.interface.decodeFunctionResult(
      functionName,
      rawResult
    );

    return BigInt(result.toString());
  }

  private async readTokenBigIntAtBlockOnce(
    functionName: 'balanceOf',
    args: readonly unknown[],
    blockNumber: number
  ): Promise<bigint> {
    const data = this.cssvTokenContract.interface.encodeFunctionData(
      functionName,
      args
    );
    const rawResult = await this.provider.call({
      to: this.config.cssvTokenAddress,
      data,
      blockTag: blockNumber
    });
    const [result] = this.cssvTokenContract.interface.decodeFunctionResult(
      functionName,
      rawResult
    );

    return BigInt(result.toString());
  }

  private async readWalletBatchWithRetry(
    normalizedWalletAddresses: string[],
    description: string,
    operation: (walletAddress: string) => Promise<bigint>
  ): Promise<Map<string, bigint>> {
    const resultsByWallet = new Map<string, bigint>();
    let pendingWalletAddresses = [...normalizedWalletAddresses];
    let retryCount = 0;

    while (pendingWalletAddresses.length > 0) {
      const nextPendingWalletAddresses: string[] = [];

      // Keep concurrent eth_call fanout bounded so one large day does not blast the RPC.
      for (
        let start = 0;
        start < pendingWalletAddresses.length;
        start += CssvSnapshotBlockchainService.PREVIEW_BATCH_SIZE
      ) {
        const batchWalletAddresses = pendingWalletAddresses.slice(
          start,
          start + CssvSnapshotBlockchainService.PREVIEW_BATCH_SIZE
        );
        const batchResults = await Promise.allSettled(
          batchWalletAddresses.map((walletAddress) => operation(walletAddress))
        );

        batchResults.forEach((result, index) => {
          const walletAddress = batchWalletAddresses[index];

          if (result.status === 'fulfilled') {
            resultsByWallet.set(walletAddress, result.value);
            return;
          }

          if (
            this.isRetryableRpcError(result.reason) &&
            retryCount < CSSV_SNAPSHOT_RPC_MAX_RETRIES
          ) {
            nextPendingWalletAddresses.push(walletAddress);
            return;
          }

          throw result.reason;
        });
      }

      if (nextPendingWalletAddresses.length === 0) {
        break;
      }

      retryCount += 1;
      const delayMs =
        CSSV_SNAPSHOT_RPC_RETRY_BASE_DELAY_MS * 2 ** (retryCount - 1);

      this.logger.warn(
        `Transient CSSV snapshot RPC failures during ${description}; retrying ` +
          `${nextPendingWalletAddresses.length} request(s) ` +
          `${retryCount}/${CSSV_SNAPSHOT_RPC_MAX_RETRIES} in ${delayMs}ms`
      );

      await this.sleep(delayMs);
      pendingWalletAddresses = nextPendingWalletAddresses;
    }

    return resultsByWallet;
  }

  private normalizeWalletAddressSet(walletAddresses: Iterable<string>): string[] {
    return [
      ...new Set(
        [...walletAddresses].map((walletAddress) =>
          ethers.getAddress(walletAddress)
        )
      )
    ];
  }

  private isRetryableRpcError(error: unknown): boolean {
    const details = this.formatRpcError(error).toLowerCase();

    return (
      details.includes('too many requests') ||
      details.includes('rate limit') ||
      details.includes('missing response for request') ||
      details.includes('timeout') ||
      details.includes('timed out') ||
      details.includes('temporarily unavailable') ||
      details.includes('socket hang up') ||
      details.includes('econnreset') ||
      details.includes('etimedout') ||
      details.includes('429') ||
      details.includes('-32005')
    );
  }

  private formatRpcError(error: unknown): string {
    if (error instanceof Error) {
      return inspect(error, { depth: 6, breakLength: Infinity });
    }

    return inspect(error, { depth: 6, breakLength: Infinity });
  }

  private async sleep(delayMs: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
