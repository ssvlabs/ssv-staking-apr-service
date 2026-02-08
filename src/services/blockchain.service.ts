import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';

// Minimal ABI for the Views contract
const VIEWS_CONTRACT_ABI = ['function accEthPerShare() view returns (uint256)'];

@Injectable()
export class BlockchainService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainService.name);
  private provider: ethers.JsonRpcProvider;
  private viewsContract: ethers.Contract;
  private readonly rpcUrl: string;
  private readonly viewsContractAddress: string;

  constructor(private configService: ConfigService) {
    this.rpcUrl = this.configService.get<string>('RPC_URL') || '';
    this.viewsContractAddress =
      this.configService.get<string>('VIEWS_CONTRACT_ADDRESS') || '';

    this.logger.debug(
      `BlockchainService constructed. RPC_URL configured: ${!!this.rpcUrl}, VIEWS_CONTRACT_ADDRESS: ${this.viewsContractAddress || 'not set'}`
    );
  }

  async onModuleInit() {
    this.logger.log('BlockchainService.onModuleInit() called');

    try {
      this.logger.log('Initializing blockchain connection');

      if (!this.rpcUrl) {
        this.logger.warn('RPC_URL is empty. Blockchain features will be disabled.');
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
        this.logger.warn('VIEWS_CONTRACT_ADDRESS is empty. Contract calls will fail.');
      }

      // Initialize Views contract
      this.logger.log(
        `Initializing Views contract at address: ${this.viewsContractAddress}`
      );
      this.viewsContract = new ethers.Contract(
        this.viewsContractAddress,
        VIEWS_CONTRACT_ABI,
        this.provider
      );

      this.logger.log(
        `Views contract initialized at ${this.viewsContractAddress}`
      );
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
   * Read accEthPerShare from the Views contract
   */
  async getAccEthPerShare(): Promise<bigint> {
    this.logger.log('getAccEthPerShare() called');

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

      this.logger.log(
        `Calling accEthPerShare() on contract ${this.viewsContractAddress}`
      );
      const startTime = Date.now();
      const accEthPerShare =
        (await this.viewsContract.accEthPerShare()) as unknown as bigint;
      const elapsed = Date.now() - startTime;

      this.logger.log(
        `accEthPerShare call completed in ${elapsed}ms. Value: ${accEthPerShare.toString()}`
      );
      this.logger.debug(
        `accEthPerShare as float (wei->ether): ${Number(accEthPerShare) / 1e18}`
      );

      return accEthPerShare;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error('Failed to read accEthPerShare', message);
      if (stack) {
        this.logger.debug(`Stack trace: ${stack}`);
      }
      throw error;
    }
  }
}