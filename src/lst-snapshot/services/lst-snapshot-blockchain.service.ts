import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { inspect } from 'node:util';
import { ethers } from 'ethers';
import { ERC20_MINIMAL_ABI } from '../abis/erc20.abi';
import { LstSnapshotConfigService } from '../config/lst-snapshot.config';
import {
  LST_SNAPSHOT_BALANCE_BATCH_DELAY_MS,
  LST_SNAPSHOT_BALANCE_BATCH_SIZE,
  LST_SNAPSHOT_RPC_MAX_RETRIES,
  LST_SNAPSHOT_RPC_RETRY_BASE_DELAY_MS
} from '../constants/lst-snapshot.constants';

@Injectable()
export class LstSnapshotBlockchainService implements OnModuleInit {
  private readonly logger = new Logger(LstSnapshotBlockchainService.name);
  private readonly provider: ethers.JsonRpcProvider;
  private readonly erc20Interface: ethers.Interface;

  constructor(private readonly config: LstSnapshotConfigService) {
    this.provider = new ethers.JsonRpcProvider(
      this.config.rpcUrl,
      this.config.chainId,
      {
        staticNetwork: true,
        batchMaxCount: 100,
        batchStallTime: 20,
        batchMaxSize: 1 << 20
      }
    );
    this.erc20Interface = new ethers.Interface(ERC20_MINIMAL_ABI);
  }

  async onModuleInit(): Promise<void> {
    const network = await this.provider.getNetwork();

    this.logger.log(
      `LST snapshot blockchain service ready on chainId=${network.chainId.toString()}`
    );
  }

  async getLatestBlockNumber(): Promise<number> {
    return this.withRetry('eth_blockNumber', () => this.provider.getBlockNumber());
  }

  async getBlockTimestamp(blockNumber: number): Promise<Date> {
    const block = await this.withRetry(
      `eth_getBlockByNumber(${blockNumber})`,
      () => this.provider.getBlock(blockNumber)
    );

    if (!block) {
      throw new Error(`Block ${blockNumber} not found`);
    }

    return new Date(Number(block.timestamp) * 1000);
  }

  async collectRecipients(
    tokenAddress: string,
    fromBlock: number,
    toBlock: number
  ): Promise<Set<string>> {
    const normalizedAddress = ethers.getAddress(tokenAddress);
    const transferTopic = this.erc20Interface.getEvent('Transfer')!.topicHash;
    const recipients = new Set<string>();
    let chunksRead = 0;

    for (
      let start = fromBlock;
      start <= toBlock;
      start += this.config.logChunkSizeBlocks
    ) {
      const end = Math.min(start + this.config.logChunkSizeBlocks - 1, toBlock);
      const logs = await this.withRetry(
        `eth_getLogs Transfer(${normalizedAddress})[${start}-${end}]`,
        () =>
          this.provider.getLogs({
            address: normalizedAddress,
            topics: [transferTopic],
            fromBlock: start,
            toBlock: end
          })
      );

      for (const log of logs) {
        const parsed = this.erc20Interface.parseLog(log);

        if (parsed && log.topics[2]) {
          recipients.add(ethers.getAddress(`0x${log.topics[2].slice(26)}`));
        }
      }

      chunksRead += 1;

      if (chunksRead % 100 === 0) {
        this.logger.debug(
          `${normalizedAddress}: read ${chunksRead} chunks, ${recipients.size} recipients so far (block ${end}/${toBlock})`
        );
      }
    }

    this.logger.log(
      `${normalizedAddress}: finished Transfer log scan, ${recipients.size} unique recipient(s)`
    );

    return recipients;
  }

  async batchBalanceOf(
    tokenAddress: string,
    addresses: string[],
    blockNumber: number
  ): Promise<Map<string, bigint>> {
    const normalizedAddress = ethers.getAddress(tokenAddress);
    const balances = new Map<string, bigint>();

    if (addresses.length === 0) {
      return balances;
    }

    let pending = [...new Set(addresses.map((a) => ethers.getAddress(a)))];
    let retryCount = 0;

    while (pending.length > 0) {
      const nextPending: string[] = [];

      for (
        let i = 0;
        i < pending.length;
        i += LST_SNAPSHOT_BALANCE_BATCH_SIZE
      ) {
        const batch = pending.slice(i, i + LST_SNAPSHOT_BALANCE_BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map((wallet) =>
            this.readBalanceOf(normalizedAddress, wallet, blockNumber)
          )
        );

        // Pace batches so the RPC node is not overwhelmed; both mainnet runs
        // saw ~70% transient failures when firing batches back-to-back.
        await this.sleep(LST_SNAPSHOT_BALANCE_BATCH_DELAY_MS);

        results.forEach((result, idx) => {
          const wallet = batch[idx];

          if (result.status === 'fulfilled') {
            balances.set(wallet, result.value);
            return;
          }

          if (
            this.isRetryable(result.reason) &&
            retryCount < LST_SNAPSHOT_RPC_MAX_RETRIES
          ) {
            nextPending.push(wallet);
            return;
          }

          throw result.reason;
        });
      }

      if (nextPending.length === 0) {
        break;
      }

      retryCount += 1;
      const delay = LST_SNAPSHOT_RPC_RETRY_BASE_DELAY_MS * 2 ** (retryCount - 1);

      this.logger.warn(
        `Retrying ${nextPending.length} balanceOf call(s) for ${normalizedAddress} ` +
          `(attempt ${retryCount}/${LST_SNAPSHOT_RPC_MAX_RETRIES}) in ${delay}ms`
      );

      await this.sleep(delay);
      pending = nextPending;
    }

    return balances;
  }

  private async readBalanceOf(
    tokenAddress: string,
    walletAddress: string,
    blockNumber: number
  ): Promise<bigint> {
    const data = this.erc20Interface.encodeFunctionData('balanceOf', [walletAddress]);
    const raw = await this.provider.call({
      to: tokenAddress,
      data,
      blockTag: blockNumber
    });
    const [result] = this.erc20Interface.decodeFunctionResult('balanceOf', raw);

    return BigInt(result.toString());
  }

  async withRetry<T>(description: string, operation: () => Promise<T>): Promise<T> {
    let retryCount = 0;

    while (true) {
      try {
        return await operation();
      } catch (error) {
        if (
          !this.isRetryable(error) ||
          retryCount >= LST_SNAPSHOT_RPC_MAX_RETRIES
        ) {
          throw error;
        }

        retryCount += 1;
        const delay = LST_SNAPSHOT_RPC_RETRY_BASE_DELAY_MS * 2 ** (retryCount - 1);

        this.logger.warn(
          `Transient RPC failure during ${description}; ` +
            `retry ${retryCount}/${LST_SNAPSHOT_RPC_MAX_RETRIES} in ${delay}ms: ` +
            this.formatError(error)
        );

        await this.sleep(delay);
      }
    }
  }

  private isRetryable(error: unknown): boolean {
    const details = this.formatError(error).toLowerCase();

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
      details.includes('-32005') ||
      // An overloaded node answers eth_call with an empty/malformed response,
      // which ethers v6 surfaces as CALL_EXCEPTION "missing revert data".
      // A plain ERC-20 balanceOf cannot genuinely revert, so treat it as
      // transient instead of aborting the whole snapshot run.
      details.includes('missing revert data') ||
      details.includes('call_exception') ||
      details.includes('bad response') ||
      details.includes('503') ||
      details.includes('service unavailable')
    );
  }

  private formatError(error: unknown): string {
    return inspect(error, { depth: 6, breakLength: Infinity });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
