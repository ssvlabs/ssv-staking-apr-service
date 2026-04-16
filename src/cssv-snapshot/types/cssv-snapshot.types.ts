export interface CssvSnapshotWindow {
  snapshotDate: string;
  fromBlockInclusive: number;
  toBlockExclusive: number;
  snapshotStateBlock: number;
}

export interface CssvSnapshotRunSeed extends CssvSnapshotWindow {
  previousSnapshotBlock: number;
  snapshotTimeUtc: Date;
  totalStakedWeiSsv: string;
  walletCount: number;
}

export interface CssvSnapshotWalletSeed {
  walletAddress: string;
  balanceWeiSsv: string;
  grossClaimableEthWei: string;
  dailyRewardAccrualWei: string;
  claimedInWindowWei: string;
  burnedDustInWindowWei: string;
}

export interface CssvWalletState {
  walletAddress: string;
  balanceWeiSsv: bigint;
  previousGrossClaimableWei: bigint;
  claimedInWindowWei: bigint;
  burnedDustInWindowWei: bigint;
}

export interface CssvRewardsSettledEvent {
  transactionHash: string;
  logIndex: number;
  walletAddress: string;
  accruedWei: bigint;
  userIndex: bigint;
}

export interface CssvRewardsClaimedEvent {
  transactionHash: string;
  logIndex: number;
  walletAddress: string;
  payoutWei: bigint;
}
