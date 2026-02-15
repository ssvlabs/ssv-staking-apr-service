import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';

// Minimal ABI for the Views contract
export const GET_NETWORK_FEE_ABI = [
  {
    type: 'function',
    name: 'getNetworkFee',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  }
] as const;
export const TOTAL_STAKED_ABI = [
  {
    type: 'function',
    name: 'totalStaked',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  }
] as const;

@Injectable()
export class BlockchainService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainService.name);
  private provider: ethers.JsonRpcProvider;
  private viewsContract: ethers.Contract;
  private stakingContract: ethers.Contract;
  private readonly rpcUrl: string;
  private readonly viewsContractAddress: string;
  private readonly stakingContractAddress: string;

  constructor(private configService: ConfigService) {
    this.rpcUrl = this.configService.get<string>('RPC_URL') || '';
    this.viewsContractAddress =
      this.configService.get<string>('VIEWS_CONTRACT_ADDRESS') || '';
    this.stakingContractAddress =
      this.configService.get<string>('STAKING_CONTRACT_ADDRESS') || '';
  }

  async onModuleInit() {
    try {
      if (!this.rpcUrl) {
        this.logger.warn(
          'RPC_URL is empty. Blockchain features will be disabled.'
        );
        return;
      }

      if (this.rpcUrl.includes('YOUR_')) {
        this.logger.warn(
          `RPC_URL contains placeholder value: "${this.rpcUrl}". Blockchain features will be disabled.`
        );
        return;
      }

      this.logger.log(
        `Creating JsonRpcProvider with URL: ${this.rpcUrl.replace(/\/[^/]*$/, '/***')}`
      );
      this.provider = new ethers.JsonRpcProvider(this.rpcUrl);

      // Test connection
      this.logger.log('Testing network connection (getNetwork)...');
      const network = await this.provider.getNetwork();
      this.logger.log(
        `Connected to network: ${network.name} (chainId: ${network.chainId})`
      );

      if (!this.viewsContractAddress) {
        this.logger.warn(
          'VIEWS_CONTRACT_ADDRESS is empty. getNetworkFee calls will fail.'
        );
      }

      if (this.viewsContractAddress) {
        // Initialize Views contract
        this.logger.log(
          `Initializing Views contract at address: ${this.viewsContractAddress}`
        );
        this.viewsContract = new ethers.Contract(
          this.viewsContractAddress,
          GET_NETWORK_FEE_ABI,
          this.provider
        );

        this.logger.log(
          `Views contract initialized at ${this.viewsContractAddress}`
        );
      }

      if (!this.stakingContractAddress) {
        this.logger.warn(
          'STAKING_CONTRACT_ADDRESS is empty. totalStaked calls will fail.'
        );
      }

      if (this.stakingContractAddress) {
        this.logger.log(
          `Initializing Staking contract at address: ${this.stakingContractAddress}`
        );
        this.stakingContract = new ethers.Contract(
          this.stakingContractAddress,
          TOTAL_STAKED_ABI,
          this.provider
        );
        this.logger.log(
          `Staking contract initialized at ${this.stakingContractAddress}`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        'Failed to initialize blockchain connection. Blockchain features will be disabled.',
        message
      );
      if (stack) {
        this.logger.debug(`Stack trace: ${stack}`);
      }
      // Don't throw - allow app to start without blockchain connection
    }
  }

  /**
   * Read getNetworkFee from the Views contract.
   * Returned value is raw wei (not normalized).
   */
  async getNetworkFee(): Promise<bigint> {
    try {
      if (!this.viewsContract) {
        this.logger.error(
          'Views contract not initialized. provider exists: ' +
            !!this.provider +
            ', viewsContractAddress: ' +
            this.viewsContractAddress
        );
        throw new Error('Views contract not initialized');
      }

      const networkFee =
        (await this.viewsContract.getNetworkFee()) as unknown as bigint;

      return networkFee;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error('Failed to read getNetworkFee', message);
      if (stack) {
        this.logger.debug(`Stack trace: ${stack}`);
      }
      throw error;
    }
  }

  /**
   * Read totalStaked from the staking contract and normalize wei -> ETH.
   */
  async getTotalStaked(): Promise<string> {
    try {
      if (!this.stakingContract) {
        this.logger.error(
          'Staking contract not initialized. provider exists: ' +
            !!this.provider +
            ', stakingContractAddress: ' +
            this.stakingContractAddress
        );
        throw new Error('Staking contract not initialized');
      }

      const totalStakedWei =
        (await this.stakingContract.totalStaked()) as unknown as bigint;

      return ethers.formatEther(totalStakedWei);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error('Failed to read totalStaked', message);
      if (stack) {
        this.logger.debug(`Stack trace: ${stack}`);
      }
      throw error;
    }
  }
}
