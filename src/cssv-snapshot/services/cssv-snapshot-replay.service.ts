import { Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
import {
  CssvBigIntLike,
  CssvClaimEventPair,
  CssvRewardsClaimedEvent,
  CssvSnapshotEvent,
  CssvSnapshotWalletRowInput,
  CssvTransferEvent,
  CssvWalletState,
  CssvWalletStateSeed
} from '../types/cssv-snapshot.types';

@Injectable()
export class CssvSnapshotReplayService {
  createWalletStateMap(
    previousState: CssvWalletStateSeed[] = []
  ): Map<string, CssvWalletState> {
    // Seed replay from the previous persisted snapshot and reset day-local counters.
    return new Map(
      previousState.map((wallet) => {
        const walletAddress = ethers.getAddress(wallet.walletAddress);

        return [
          walletAddress,
          {
            walletAddress,
            balanceWeiSsv: this.toBigInt(wallet.balanceWeiSsv),
            previousGrossClaimableWei: this.toBigInt(
              wallet.previousGrossClaimableWei
            ),
            claimedInWindowWei: 0n,
            burnedDustInWindowWei: 0n
          }
        ];
      })
    );
  }

  buildWalletQuerySet(
    previousState: CssvWalletStateSeed[],
    events: CssvSnapshotEvent[],
    pairedClaims: CssvClaimEventPair[]
  ): string[] {
    // Only this wallet set needs previewClaimableEth at the snapshot boundary.
    const walletAddresses = new Set<string>();

    for (const wallet of previousState) {
      walletAddresses.add(ethers.getAddress(wallet.walletAddress));
    }

    for (const event of events) {
      switch (event.kind) {
        case 'transfer':
          if (event.from !== ethers.ZeroAddress) {
            walletAddresses.add(ethers.getAddress(event.from));
          }

          if (event.to !== ethers.ZeroAddress) {
            walletAddresses.add(ethers.getAddress(event.to));
          }
          break;
        case 'rewardsSettled':
          break;
        case 'rewardsClaimed':
          walletAddresses.add(ethers.getAddress(event.walletAddress));
          break;
      }
    }

    for (const pair of pairedClaims) {
      walletAddresses.add(ethers.getAddress(pair.walletAddress));
    }

    return [...walletAddresses];
  }

  applyEvents(
    walletStateMap: Map<string, CssvWalletState>,
    events: CssvSnapshotEvent[],
    pairedClaims: CssvClaimEventPair[]
  ): void {
    const pairedClaimsByKey = new Map(
      pairedClaims.map((pair) => [this.getClaimPairKey(pair.rewardsClaimed), pair])
    );

    for (const event of events) {
      switch (event.kind) {
        case 'transfer':
          this.applyTransfer(walletStateMap, event);
          break;
        case 'rewardsSettled':
          // Settlements only matter when paired with a later claim in the same tx.
          break;
        case 'rewardsClaimed':
          this.applyClaim(walletStateMap, event, pairedClaimsByKey);
          break;
      }
    }
  }

  buildSnapshotWalletRows(
    walletStateMap: Map<string, CssvWalletState>,
    currentPreviewByWallet: ReadonlyMap<string, CssvBigIntLike>
  ): CssvSnapshotWalletRowInput[] {
    const rows: CssvSnapshotWalletRowInput[] = [];

    for (const state of walletStateMap.values()) {
      const currentPreviewWei = this.getCurrentPreviewWei(
        currentPreviewByWallet,
        state.walletAddress
      );
      // Contract-aligned daily accrual adds back payouts and burned dust removed during the day.
      const dailyRewardAccrualWei =
        currentPreviewWei +
        state.claimedInWindowWei +
        state.burnedDustInWindowWei -
        state.previousGrossClaimableWei;

      if (
        !this.shouldPersistWalletState(state, currentPreviewWei, dailyRewardAccrualWei)
      ) {
        continue;
      }

      rows.push({
        walletAddress: state.walletAddress,
        balanceWeiSsv: state.balanceWeiSsv,
        grossClaimableEthWei: currentPreviewWei,
        dailyRewardAccrualWei,
        claimedInWindowWei: state.claimedInWindowWei,
        burnedDustInWindowWei: state.burnedDustInWindowWei
      });
    }

    return rows;
  }

  private applyTransfer(
    walletStateMap: Map<string, CssvWalletState>,
    transfer: CssvTransferEvent
  ): void {
    if (transfer.from !== ethers.ZeroAddress) {
      const senderState = this.getOrCreateWalletState(
        walletStateMap,
        transfer.from
      );
      this.applyBalanceDelta(senderState, -transfer.amountWei);
    }

    if (transfer.to !== ethers.ZeroAddress) {
      const recipientState = this.getOrCreateWalletState(
        walletStateMap,
        transfer.to
      );
      this.applyBalanceDelta(recipientState, transfer.amountWei);
    }
  }

  private applyClaim(
    walletStateMap: Map<string, CssvWalletState>,
    claim: CssvRewardsClaimedEvent,
    pairedClaimsByKey: ReadonlyMap<string, CssvClaimEventPair>
  ): void {
    const walletState = this.getOrCreateWalletState(
      walletStateMap,
      claim.walletAddress
    );
    const pair = pairedClaimsByKey.get(
      this.getClaimPairKey(claim)
    );

    if (!pair) {
      throw new Error(
        `Missing paired RewardsSettled for CSSV claim ${claim.transactionHash}:${claim.walletAddress}`
      );
    }

    walletState.claimedInWindowWei += claim.payoutWei;

    const remainderWei = pair.rewardsSettled.accruedWei - claim.payoutWei;

    if (remainderWei < 0n) {
      throw new Error(
        `Invalid CSSV claim pair ${claim.transactionHash}:${claim.walletAddress}: accrued ${pair.rewardsSettled.accruedWei} < payout ${claim.payoutWei}`
      );
    }

    // Dust is only wiped when the claim executes while the wallet cSSV balance is zero.
    if (walletState.balanceWeiSsv === 0n && remainderWei > 0n) {
      walletState.burnedDustInWindowWei += remainderWei;
    }
  }

  private getOrCreateWalletState(
    walletStateMap: Map<string, CssvWalletState>,
    walletAddress: string
  ): CssvWalletState {
    const normalizedWalletAddress = ethers.getAddress(walletAddress);
    const existingState = walletStateMap.get(normalizedWalletAddress);

    if (existingState) {
      return existingState;
    }

    const newState: CssvWalletState = {
      walletAddress: normalizedWalletAddress,
      balanceWeiSsv: 0n,
      previousGrossClaimableWei: 0n,
      claimedInWindowWei: 0n,
      burnedDustInWindowWei: 0n
    };
    walletStateMap.set(normalizedWalletAddress, newState);

    return newState;
  }

  private applyBalanceDelta(state: CssvWalletState, deltaWei: bigint): void {
    const nextBalanceWeiSsv = state.balanceWeiSsv + deltaWei;

    if (nextBalanceWeiSsv < 0n) {
      throw new Error(
        `CSSV wallet ${state.walletAddress} balance became negative during replay`
      );
    }

    state.balanceWeiSsv = nextBalanceWeiSsv;
  }

  private getCurrentPreviewWei(
    currentPreviewByWallet: ReadonlyMap<string, CssvBigIntLike>,
    walletAddress: string
  ): bigint {
    const previewWei = currentPreviewByWallet.get(walletAddress);

    if (previewWei === undefined) {
      throw new Error(
        `Missing CSSV previewClaimableEth snapshot value for wallet ${walletAddress}`
      );
    }

    return this.toBigInt(previewWei);
  }

  private shouldPersistWalletState(
    state: CssvWalletState,
    currentPreviewWei: bigint,
    dailyRewardAccrualWei: bigint
  ): boolean {
    // Keep wallets that still carry balance, claimable rewards, or any day-local accounting.
    return (
      state.balanceWeiSsv !== 0n ||
      currentPreviewWei !== 0n ||
      state.claimedInWindowWei !== 0n ||
      state.burnedDustInWindowWei !== 0n ||
      dailyRewardAccrualWei !== 0n
    );
  }

  private getClaimPairKey(input: {
    transactionHash: string;
    walletAddress: string;
    logIndex: number;
  }): string {
    return `${input.transactionHash}:${ethers.getAddress(input.walletAddress)}:${input.logIndex}`;
  }

  private toBigInt(value: CssvBigIntLike): bigint {
    return typeof value === 'bigint' ? value : BigInt(value);
  }
}
