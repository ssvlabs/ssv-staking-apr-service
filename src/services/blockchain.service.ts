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
  }

  async onModuleInit() {
    try {
      this.logger.log('Initializing blockchain connection');

      if (!this.rpcUrl || this.rpcUrl.includes('YOUR_')) {
        this.logger.warn(
          'RPC_URL not configured properly. Blockchain features will be disabled.',
        );
        return;
      }

      this.provider = new ethers.JsonRpcProvider(this.rpcUrl);

      // Test connection
      const network = await this.provider.getNetwork();
      this.logger.log(
        `Connected to network: ${network.name} (${network.chainId})`,
      );

      // Initialize Views contract
      this.viewsContract = new ethers.Contract(
        this.viewsContractAddress,
        VIEWS_CONTRACT_ABI,
        this.provider,
      );

      this.logger.log(
        `Views contract initialized at ${this.viewsContractAddress}`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to initialize blockchain connection. Blockchain features will be disabled.',
        error instanceof Error ? error.message : String(error),
      );
      // Don't throw - allow app to start without blockchain connection
    }
  }

  /**
   * Read accEthPerShare from the Views contract
   */
  async getAccEthPerShare(): Promise<bigint> {
    try {
      if (!this.viewsContract) {
        throw new Error('Views contract not initialized');
      }

      this.logger.log('Reading accEthPerShare from Views contract');
      const accEthPerShare =
        (await this.viewsContract.accEthPerShare()) as unknown as bigint;

      this.logger.log(`accEthPerShare: ${accEthPerShare.toString()}`);
      return accEthPerShare;
    } catch (error) {
      this.logger.error(
        'Failed to read accEthPerShare',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }
}
