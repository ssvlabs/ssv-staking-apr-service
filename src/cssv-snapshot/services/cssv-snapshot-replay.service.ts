import { Injectable } from '@nestjs/common';
import { CssvWalletState } from '../types/cssv-snapshot.types';

@Injectable()
export class CssvSnapshotReplayService {
  createWalletStateMap(previousState: CssvWalletState[] = []): Map<string, CssvWalletState> {
    return new Map(previousState.map((wallet) => [wallet.walletAddress, wallet]));
  }
}
