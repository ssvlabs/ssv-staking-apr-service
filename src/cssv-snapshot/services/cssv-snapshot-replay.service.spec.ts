import {
  CssvClaimEventPair,
  CssvRewardsClaimedEvent,
  CssvRewardsSettledEvent
} from '../types/cssv-snapshot.types';
import { CssvSnapshotReplayService } from './cssv-snapshot-replay.service';

describe('CssvSnapshotReplayService', () => {
  const service = new CssvSnapshotReplayService();
  const userA = '0x1111111111111111111111111111111111111111';

  it('does not burn dust when claim executes with nonzero cSSV balance', () => {
    const walletStateMap = service.createWalletStateMap([
      {
        walletAddress: userA,
        balanceWeiSsv: 100n,
        previousGrossClaimableWei: 0n
      }
    ]);
    const rewardsSettled: CssvRewardsSettledEvent = {
      kind: 'rewardsSettled',
      transactionHash:
        '0x0000000000000000000000000000000000000000000000000000000000000001',
      blockNumber: 1,
      transactionIndex: 0,
      logIndex: 0,
      walletAddress: userA,
      pendingWei: 0n,
      accruedWei: 250_001n,
      userIndex: 1n
    };
    const rewardsClaimed: CssvRewardsClaimedEvent = {
      kind: 'rewardsClaimed',
      transactionHash:
        '0x0000000000000000000000000000000000000000000000000000000000000001',
      blockNumber: 1,
      transactionIndex: 0,
      logIndex: 1,
      walletAddress: userA,
      payoutWei: 200_000n
    };
    const events = [
      rewardsSettled,
      rewardsClaimed
    ];
    const pairedClaims: CssvClaimEventPair[] = [
      {
        transactionHash:
          '0x0000000000000000000000000000000000000000000000000000000000000001',
        walletAddress: userA,
        rewardsSettled,
        rewardsClaimed
      }
    ];

    service.applyEvents(walletStateMap, events, pairedClaims);

    expect(walletStateMap.get(userA)).toMatchObject({
      balanceWeiSsv: 100n,
      claimedInWindowWei: 200_000n,
      burnedDustInWindowWei: 0n
    });

    expect(
      service.buildSnapshotWalletRows(
        walletStateMap,
        new Map([[userA, 50_001n]])
      )
    ).toEqual([
      {
        walletAddress: userA,
        balanceWeiSsv: 100n,
        grossClaimableEthWei: 50_001n,
        dailyRewardAccrualWei: 250_001n,
        claimedInWindowWei: 200_000n,
        burnedDustInWindowWei: 0n
      }
    ]);
  });

  it('throws when a RewardsClaimed event is missing its paired settlement', () => {
    const walletStateMap = service.createWalletStateMap();
    const events = [
      {
        kind: 'rewardsClaimed' as const,
        transactionHash:
          '0x0000000000000000000000000000000000000000000000000000000000000002',
        blockNumber: 1,
        transactionIndex: 0,
        logIndex: 0,
        walletAddress: userA,
        payoutWei: 1n
      }
    ];

    expect(() => service.applyEvents(walletStateMap, events, [])).toThrow(
      'Missing paired RewardsSettled'
    );
  });
});
