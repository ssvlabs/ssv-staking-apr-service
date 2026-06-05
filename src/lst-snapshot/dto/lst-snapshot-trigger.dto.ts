import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class LstSnapshotTriggerDto {
  @ApiPropertyOptional({
    description:
      'Block number to snapshot. Defaults to the latest block when omitted.'
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  blockNumber?: number;
}

export class LstSnapshotTriggerResponseDto {
  @ApiPropertyOptional({ description: 'Whether the snapshot was accepted (false if already running)' })
  accepted!: boolean;
}
