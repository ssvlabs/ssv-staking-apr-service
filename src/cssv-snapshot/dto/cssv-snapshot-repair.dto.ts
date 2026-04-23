import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class CssvSnapshotRepairRequestDto {
  @ApiProperty({
    description:
      'Snapshot business date in UTC to repair from. The service deletes that day and all later days, then rebuilds them.',
    example: '2026-04-18'
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'snapshotDate must be in YYYY-MM-DD format'
  })
  snapshotDate!: string;
}

export class CssvSnapshotRepairResponseDto {
  @ApiProperty({
    description: 'Snapshot business date in UTC that repair started from.',
    example: '2026-04-18'
  })
  snapshotDate!: string;

  @ApiProperty({
    description: 'Number of persisted snapshot days deleted before rebuilding.',
    example: 2
  })
  deletedRuns!: number;

  @ApiProperty({
    description: 'Number of snapshot days rebuilt after the delete step.',
    example: 2
  })
  createdRuns!: number;
}
