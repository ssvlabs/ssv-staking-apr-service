import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class CssvSnapshotListQueryDto {
  @ApiPropertyOptional({
    description: 'Maximum number of snapshot rows to return (default: 10).',
    minimum: 1,
    default: 10
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Number of snapshot rows to skip before returning results (default: 0).',
    minimum: 0,
    default: 0
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
