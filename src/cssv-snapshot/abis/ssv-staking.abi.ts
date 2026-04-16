export const CSSV_SNAPSHOT_STAKING_MINIMAL_ABI = [
  {
    type: 'event',
    name: 'RewardsSettled',
    anonymous: false,
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'pending', type: 'uint256', indexed: false },
      { name: 'accrued', type: 'uint256', indexed: false },
      { name: 'userIndex', type: 'uint256', indexed: false }
    ]
  },
  {
    type: 'event',
    name: 'RewardsClaimed',
    anonymous: false,
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false }
    ]
  }
] as const;
