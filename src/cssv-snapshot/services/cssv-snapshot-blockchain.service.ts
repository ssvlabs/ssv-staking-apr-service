import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ethers } from 'ethers';
import { CSSV_SNAPSHOT_STAKING_MINIMAL_ABI } from '../abis/ssv-staking.abi';
import { CSSV_SNAPSHOT_VIEWS_MINIMAL_ABI } from '../abis/ssv-views.abi';
import { CssvSnapshotConfigService } from '../config/cssv-snapshot.config';

@Injectable()
export class CssvSnapshotBlockchainService implements OnModuleInit {
  private readonly logger = new Logger(CssvSnapshotBlockchainService.name);
  private readonly provider: ethers.JsonRpcProvider;
  private readonly viewsContract: ethers.Contract;
  private readonly stakingContract: ethers.Contract;

  constructor(private readonly config: CssvSnapshotConfigService) {
    this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
    this.viewsContract = new ethers.Contract(
      this.config.viewsContractAddress,
      CSSV_SNAPSHOT_VIEWS_MINIMAL_ABI,
      this.provider
    );
    this.stakingContract = new ethers.Contract(
      this.config.stakingContractAddress,
      CSSV_SNAPSHOT_STAKING_MINIMAL_ABI,
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

  getViewsContract(): ethers.Contract {
    return this.viewsContract;
  }

  getStakingContract(): ethers.Contract {
    return this.stakingContract;
  }

  getStakingContractAddress(): string {
    return this.config.stakingContractAddress;
  }
}
