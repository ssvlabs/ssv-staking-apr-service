export interface LstHolderRowInput {
  walletAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  balanceWei: bigint;
}

export interface LstTokenBalance {
  symbol: string;
  tokenAddress: string;
  balanceWei: string;
}

export interface LstEligibilityResult {
  walletAddress: string;
  eligible: boolean;
  snapshotBlock: string | null;
  tokens: LstTokenBalance[];
}
