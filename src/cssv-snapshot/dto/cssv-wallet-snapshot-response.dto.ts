import { ApiProperty } from '@nestjs/swagger';

export class CssvWalletSnapshotDto {
  @ApiProperty({
    description:
      'Snapshot business date in UTC. Represents the daily 12:00:00 UTC snapshot for that date.',
    example: '2026-04-15'
  })
  snapshotDate!: string;

  @ApiProperty({
    description:
      'Exact UTC snapshot timestamp. For v1 this is always 12:00:00Z on snapshotDate.',
    example: '2026-04-15T12:00:00.000Z'
  })
  snapshotTimeUtc!: string;

  @ApiProperty({
    description: 'First included execution-layer block in the snapshot range.',
    example: 22001000
  })
  fromBlock!: number;

  @ApiProperty({
    description: 'Last included execution-layer block in the snapshot range.',
    example: 22008210
  })
  toBlock!: number;

  @ApiProperty({
    description:
      'Wallet cSSV balance at the snapshot boundary, denominated in wei of SSV.',
    example: '500000000000000000000'
  })
  balanceWeiSsv!: string;

  @ApiProperty({
    description:
      'Net ETH rewards accrued by the wallet during the snapshot block range, denominated in wei. This includes rewards still claimable at the boundary plus rewards already claimed during the window, and includes burned dust adjustments so the value stays exactly aligned with contract accounting.',
    example: '1234500000000000'
  })
  dailyRewardAccrualWei!: string;

  @ApiProperty({
    description:
      'Total ETH rewards still claimable by the wallet at the snapshot boundary, denominated in wei.',
    example: '9876500000000000'
  })
  grossClaimableEthWei!: string;

  @ApiProperty({
    description:
      'ETH rewards actually paid out to the wallet during this snapshot window via RewardsClaimed, denominated in wei.',
    example: '500000000000000'
  })
  claimedInWindowWei!: string;

  @ApiProperty({
    description:
      'Tiny reward remainder removed during claim rounding when the wallet had zero cSSV balance, denominated in wei. This is an accounting field used to keep dailyRewardAccrualWei exactly aligned with contract behavior. Per affected claim, the burned amount is always < 100000 wei.',
    example: '0'
  })
  burnedDustInWindowWei!: string;
}

export class CssvWalletSnapshotsResponseDto {
  @ApiProperty({
    description: 'Canonical EIP-55 checksummed wallet address used for the lookup.',
    example: '0x1234567890AbCdEF1234567890abCDef12345678'
  })
  ownerAddress!: string;

  @ApiProperty({
    description: 'Daily CSSV snapshot rows for the requested wallet, ordered from latest to oldest.',
    type: () => [CssvWalletSnapshotDto]
  })
  snapshots!: CssvWalletSnapshotDto[];
}
