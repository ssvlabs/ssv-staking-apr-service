import { Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
import { CSSV_TOKEN_MINIMAL_ABI } from '../abis/cssv-token.abi';
import { CSSV_SNAPSHOT_STAKING_MINIMAL_ABI } from '../abis/ssv-staking.abi';
import { CssvSnapshotBlockchainService } from './cssv-snapshot-blockchain.service';

@Injectable()
export class CssvSnapshotLogReaderService {
  readonly cssvTransferInterface = new ethers.Interface(CSSV_TOKEN_MINIMAL_ABI);
  readonly stakingInterface = new ethers.Interface(
    CSSV_SNAPSHOT_STAKING_MINIMAL_ABI
  );

  constructor(
    private readonly blockchainService: CssvSnapshotBlockchainService
  ) {}

  getProvider(): ethers.JsonRpcProvider {
    return this.blockchainService.getProvider();
  }
}
