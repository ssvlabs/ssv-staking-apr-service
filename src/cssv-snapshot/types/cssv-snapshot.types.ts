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

export interface CssvWalletStateSeed {
  walletAddress: string;
  balanceWeiSsv: CssvBigIntLike;
  previousGrossClaimableWei: CssvBigIntLike;
}

export interface CssvSnapshotWalletRowInput {
  walletAddress: string;
  balanceWeiSsv: CssvBigIntLike;
  grossClaimableEthWei: CssvBigIntLike;
  dailyRewardAccrualWei: CssvBigIntLike;
  claimedInWindowWei: CssvBigIntLike;
  burnedDustInWindowWei: CssvBigIntLike;
}

export interface CssvSnapshotBaseEvent {
  transactionHash: string;
  blockNumber: number;
  transactionIndex: number;
  logIndex: number;
}

export interface CssvTransferEvent extends CssvSnapshotBaseEvent {
  kind: 'transfer';
  from: string;
  to: string;
  amountWei: bigint;
}

export interface CssvWalletState {
  walletAddress: string;
  balanceWeiSsv: bigint;
  previousGrossClaimableWei: bigint;
  claimedInWindowWei: bigint;
  burnedDustInWindowWei: bigint;
}

export interface CssvRewardsSettledEvent extends CssvSnapshotBaseEvent {
  kind: 'rewardsSettled';
  walletAddress: string;
  pendingWei: bigint;
  accruedWei: bigint;
  userIndex: bigint;
}

export interface CssvRewardsClaimedEvent extends CssvSnapshotBaseEvent {
  kind: 'rewardsClaimed';
  walletAddress: string;
  payoutWei: bigint;
}

export type CssvSnapshotEvent =
  | CssvTransferEvent
  | CssvRewardsSettledEvent
  | CssvRewardsClaimedEvent;

export interface CssvClaimEventPair {
  transactionHash: string;
  walletAddress: string;
  rewardsSettled: CssvRewardsSettledEvent;
  rewardsClaimed: CssvRewardsClaimedEvent;
}

export interface CssvSnapshotEventReadResult {
  events: CssvSnapshotEvent[];
  pairedClaims: CssvClaimEventPair[];
}
