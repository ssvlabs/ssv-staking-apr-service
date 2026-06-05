import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LstTokenBalanceDto {
  @ApiProperty({ description: 'Token symbol (e.g. stETH, LDO)' })
  symbol!: string;

  @ApiProperty({ description: 'EIP-55 checksummed token contract address' })
  tokenAddress!: string;

  @ApiProperty({ description: 'Token balance in wei at the snapshot block' })
  balanceWei!: string;
}

export class LstEligibilityResponseDto {
  @ApiProperty({ description: 'EIP-55 checksummed wallet address' })
  walletAddress!: string;

  @ApiProperty({
    description:
      'True if the wallet held at least one eligible LST/LRT token at the snapshot block'
  })
  eligible!: boolean;

  @ApiPropertyOptional({
    description: 'The block number at which eligibility was evaluated, or null if no snapshot exists yet',
    nullable: true
  })
  snapshotBlock!: string | null;

  @ApiProperty({
    type: [LstTokenBalanceDto],
    description: 'List of eligible tokens held by this wallet at the snapshot block'
  })
  tokens!: LstTokenBalanceDto[];
}
