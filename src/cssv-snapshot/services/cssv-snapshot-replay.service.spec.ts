import { ethers } from 'ethers';
import {
  CssvClaimEventPair,
  CssvRewardsClaimedEvent,
  CssvRewardsSettledEvent,
  CssvTransferEvent
} from '../types/cssv-snapshot.types';
import { CssvSnapshotReplayService } from './cssv-snapshot-replay.service';

describe('CssvSnapshotReplayService', () => {
  const service = new CssvSnapshotReplayService();
  const userA = '0x1111111111111111111111111111111111111111';
  const userB = '0x2222222222222222222222222222222222222222';
  const userC = '0x3333333333333333333333333333333333333333';

  it('builds wallet query set from previous wallets, transfer touches, and claim users', () => {
    const transferEvent: CssvTransferEvent = {
      kind: 'transfer',
      transactionHash:
        '0x0000000000000000000000000000000000000000000000000000000000000010',
      blockNumber: 1,
      transactionIndex: 0,
      logIndex: 0,
      from: userA,
      to: userB,
      amountWei: 1n
    };
    const rewardsSettled: CssvRewardsSettledEvent = {
      kind: 'rewardsSettled',
      transactionHash:
        '0x0000000000000000000000000000000000000000000000000000000000000011',
      blockNumber: 1,
      transactionIndex: 0,
      logIndex: 1,
      walletAddress: userB,
      pendingWei: 0n,
      accruedWei: 10n,
      userIndex: 1n
    };
    const rewardsClaimed: CssvRewardsClaimedEvent = {
      kind: 'rewardsClaimed',
      transactionHash:
        '0x0000000000000000000000000000000000000000000000000000000000000011',
      blockNumber: 1,
      transactionIndex: 0,
      logIndex: 2,
      walletAddress: userB,
      payoutWei: 10n
    };

    const walletQuerySet = service.buildWalletQuerySet(
      [
        {
          walletAddress: userC,
          balanceWeiSsv: 5n,
          previousGrossClaimableWei: 2n
        }
      ],
      [transferEvent, rewardsSettled, rewardsClaimed],
      [
        {
          transactionHash: rewardsClaimed.transactionHash,
          walletAddress: rewardsClaimed.walletAddress,
          rewardsSettled,
          rewardsClaimed
        }
      ]
    );

    expect(walletQuerySet).toHaveLength(3);
    expect(walletQuerySet).toEqual(
      expect.arrayContaining([
        ethers.getAddress(userA),
        ethers.getAddress(userB),
        ethers.getAddress(userC)
      ])
    );
  });

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

  it('accumulates multiple claims in one day and burns dust only for zero-balance claims', () => {
    const walletStateMap = service.createWalletStateMap([
      {
        walletAddress: userA,
        balanceWeiSsv: 5n,
        previousGrossClaimableWei: 100n
      }
    ]);
    const transferOut: CssvTransferEvent = {
      kind: 'transfer',
      transactionHash:
        '0x0000000000000000000000000000000000000000000000000000000000000012',
      blockNumber: 1,
      transactionIndex: 0,
      logIndex: 0,
      from: userA,
      to: userB,
      amountWei: 5n
    };
    const firstSettled: CssvRewardsSettledEvent = {
      kind: 'rewardsSettled',
      transactionHash:
        '0x0000000000000000000000000000000000000000000000000000000000000013',
      blockNumber: 1,
      transactionIndex: 0,
      logIndex: 1,
      walletAddress: userA,
      pendingWei: 0n,
      accruedWei: 250_001n,
      userIndex: 1n
    };
    const firstClaimed: CssvRewardsClaimedEvent = {
      kind: 'rewardsClaimed',
      transactionHash: firstSettled.transactionHash,
      blockNumber: 1,
      transactionIndex: 0,
      logIndex: 2,
      walletAddress: userA,
      payoutWei: 200_000n
    };
    const transferIn: CssvTransferEvent = {
      kind: 'transfer',
      transactionHash:
        '0x0000000000000000000000000000000000000000000000000000000000000014',
      blockNumber: 1,
      transactionIndex: 0,
      logIndex: 3,
      from: userB,
      to: userA,
      amountWei: 2n
    };
    const secondSettled: CssvRewardsSettledEvent = {
      kind: 'rewardsSettled',
      transactionHash:
        '0x0000000000000000000000000000000000000000000000000000000000000015',
      blockNumber: 1,
      transactionIndex: 0,
      logIndex: 4,
      walletAddress: userA,
      pendingWei: 0n,
      accruedWei: 300_001n,
      userIndex: 2n
    };
    const secondClaimed: CssvRewardsClaimedEvent = {
      kind: 'rewardsClaimed',
      transactionHash: secondSettled.transactionHash,
      blockNumber: 1,
      transactionIndex: 0,
      logIndex: 5,
      walletAddress: userA,
      payoutWei: 300_000n
    };

    service.applyEvents(
      walletStateMap,
      [
        transferOut,
        firstSettled,
        firstClaimed,
        transferIn,
        secondSettled,
        secondClaimed
      ],
      [
        {
          transactionHash: firstClaimed.transactionHash,
          walletAddress: userA,
          rewardsSettled: firstSettled,
          rewardsClaimed: firstClaimed
        },
        {
          transactionHash: secondClaimed.transactionHash,
          walletAddress: userA,
          rewardsSettled: secondSettled,
          rewardsClaimed: secondClaimed
        }
      ]
    );

    expect(walletStateMap.get(ethers.getAddress(userA))).toMatchObject({
      balanceWeiSsv: 2n,
      claimedInWindowWei: 500_000n,
      burnedDustInWindowWei: 50_001n
    });
  });

  it('replays a same-tx claim plus unstake using the settle that precedes the claim', () => {
    const walletStateMap = service.createWalletStateMap([
      {
        walletAddress: userA,
        balanceWeiSsv: 20n,
        previousGrossClaimableWei: 0n
      }
    ]);
    const firstSettled: CssvRewardsSettledEvent = {
      kind: 'rewardsSettled',
      transactionHash:
        '0x0000000000000000000000000000000000000000000000000000000000000016',
      blockNumber: 1,
      transactionIndex: 0,
      logIndex: 0,
      walletAddress: userA,
      pendingWei: 0n,
      accruedWei: 250_001n,
      userIndex: 3n
    };
    const claimed: CssvRewardsClaimedEvent = {
      kind: 'rewardsClaimed',
      transactionHash: firstSettled.transactionHash,
      blockNumber: 1,
      transactionIndex: 0,
      logIndex: 1,
      walletAddress: userA,
      payoutWei: 200_000n
    };
    const secondSettled: CssvRewardsSettledEvent = {
      kind: 'rewardsSettled',
      transactionHash: firstSettled.transactionHash,
      blockNumber: 1,
      transactionIndex: 0,
      logIndex: 2,
      walletAddress: userA,
      pendingWei: 0n,
      accruedWei: 50_001n,
      userIndex: 3n
    };
    const burnTransfer: CssvTransferEvent = {
      kind: 'transfer',
      transactionHash: firstSettled.transactionHash,
      blockNumber: 1,
      transactionIndex: 0,
      logIndex: 3,
      from: userA,
      to: ethers.ZeroAddress,
      amountWei: 20n
    };

    expect(() =>
      service.applyEvents(
        walletStateMap,
        [firstSettled, claimed, secondSettled, burnTransfer],
        [
          {
            transactionHash: claimed.transactionHash,
            walletAddress: userA,
            rewardsSettled: firstSettled,
            rewardsClaimed: claimed
          }
        ]
      )
    ).not.toThrow();

    expect(walletStateMap.get(ethers.getAddress(userA))).toMatchObject({
      balanceWeiSsv: 0n,
      claimedInWindowWei: 200_000n,
      burnedDustInWindowWei: 0n
    });

    expect(
      service.buildSnapshotWalletRows(walletStateMap, new Map([[userA, 50_001n]]))
    ).toEqual([
      {
        walletAddress: ethers.getAddress(userA),
        balanceWeiSsv: 0n,
        grossClaimableEthWei: 50_001n,
        dailyRewardAccrualWei: 250_001n,
        claimedInWindowWei: 200_000n,
        burnedDustInWindowWei: 0n
      }
    ]);
  });

  it('keeps no-activity wallets when they still have claimable rewards', () => {
    const walletStateMap = service.createWalletStateMap([
      {
        walletAddress: userA,
        balanceWeiSsv: 0n,
        previousGrossClaimableWei: 10n
      }
    ]);

    expect(
      service.buildSnapshotWalletRows(walletStateMap, new Map([[userA, 5n]]))
    ).toEqual([
      {
        walletAddress: ethers.getAddress(userA),
        balanceWeiSsv: 0n,
        grossClaimableEthWei: 5n,
        dailyRewardAccrualWei: -5n,
        claimedInWindowWei: 0n,
        burnedDustInWindowWei: 0n
      }
    ]);
  });

  it('drops zero rows when nothing remains to persist', () => {
    const walletStateMap = service.createWalletStateMap([
      {
        walletAddress: userA,
        balanceWeiSsv: 0n,
        previousGrossClaimableWei: 0n
      }
    ]);

    expect(
      service.buildSnapshotWalletRows(walletStateMap, new Map([[userA, 0n]]))
    ).toEqual([]);
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
