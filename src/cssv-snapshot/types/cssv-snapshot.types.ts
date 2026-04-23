export type CssvBigIntLike = string | number | bigint;

export interface CssvBlockHeader {
  number: number;
  timestamp: number;
}

export interface CssvSnapshotWindow {
  snapshotDate: string;
  fromBlockInclusive: number;
  toBlockExclusive: number;
  snapshotStateBlock: number;
}

export interface CssvSnapshotRunSeed {
  snapshotDate: string;
  fromBlockInclusive: CssvBigIntLike;
  toBlockExclusive: CssvBigIntLike;
  snapshotStateBlock: CssvBigIntLike;
  previousSnapshotBlock: CssvBigIntLike;
  snapshotTimeUtc: Date;
  totalStakedWeiSsv: CssvBigIntLike;
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

export interface CssvSnapshotWalletRowInput {
  walletAddress: string;
  balanceWeiSsv: CssvBigIntLike;
  grossClaimableEthWei: CssvBigIntLike;
  dailyRewardAccrualWei: CssvBigIntLike;
  claimedInWindowWei: CssvBigIntLike;
  burnedDustInWindowWei: CssvBigIntLike;
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
