import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiTags
} from '@nestjs/swagger';
import { CssvSnapshotOrchestratorService } from '../services/cssv-snapshot-orchestrator.service';
import { CssvSnapshotReadService } from '../services/cssv-snapshot-read.service';
import { CssvSnapshotListQueryDto } from '../dto/cssv-snapshot-list-query.dto';
import { CssvWalletSnapshotsResponseDto } from '../dto/cssv-wallet-snapshot-response.dto';
import {
  CssvSnapshotRepairRequestDto,
  CssvSnapshotRepairResponseDto
} from '../dto/cssv-snapshot-repair.dto';

@ApiTags('apr')
@Controller('apr')
export class CssvSnapshotController {
  constructor(
    private readonly readService: CssvSnapshotReadService,
    private readonly orchestratorService: CssvSnapshotOrchestratorService
  ) {}

  @Get('snapshots/:ownerAddress')
  @ApiOperation({
    summary: 'Get daily CSSV snapshots for a wallet',
    description:
      'Returns persisted daily CSSV snapshot rows for one wallet, ordered from latest snapshot date to oldest.'
  })
  @ApiParam({
    name: 'ownerAddress',
    description: 'Wallet address to look up. The response always uses canonical EIP-55 checksum form.'
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of snapshot rows to return (default: 10).'
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of snapshot rows to skip before returning results (default: 0).'
  })
  @ApiOkResponse({
    description:
      'Successfully retrieved wallet snapshot rows. Returns snapshots: [] when the address is valid but has no saved rows.',
    type: CssvWalletSnapshotsResponseDto
  })
  @ApiBadRequestResponse({
    description: 'Invalid owner address or pagination query params.'
  })
  async getWalletSnapshots(
    @Param('ownerAddress') ownerAddress: string,
    @Query() query: CssvSnapshotListQueryDto
  ): Promise<CssvWalletSnapshotsResponseDto> {
    return this.readService.listWalletSnapshots(
      ownerAddress,
      query.limit,
      query.offset
    );
  }

  @Post('admin/snapshots/repair')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Repair CSSV snapshots from one business date',
    description:
      'Internal admin endpoint. Deletes the provided snapshot date and all later days, then rebuilds them from the last known-good persisted day.'
  })
  @ApiBody({
    type: CssvSnapshotRepairRequestDto
  })
  @ApiOkResponse({
    description: 'Repair finished successfully.',
    type: CssvSnapshotRepairResponseDto
  })
  @ApiBadRequestResponse({
    description: 'Invalid snapshotDate.'
  })
  async repairSnapshots(
    @Body() body: CssvSnapshotRepairRequestDto
  ): Promise<CssvSnapshotRepairResponseDto> {
    if (!this.isValidSnapshotDate(body.snapshotDate)) {
      throw new BadRequestException('Invalid snapshotDate');
    }

    const result = await this.orchestratorService.runLockedRepairFromSnapshotDate(
      body.snapshotDate
    );

    return {
      snapshotDate: body.snapshotDate,
      deletedRuns: result.deletedRuns,
      createdRuns: result.createdRuns
    };
  }

  private isValidSnapshotDate(snapshotDate: string): boolean {
    const parsedDate = new Date(`${snapshotDate}T00:00:00.000Z`);

    return !Number.isNaN(parsedDate.getTime()) &&
      parsedDate.toISOString().slice(0, 10) === snapshotDate;
  }
}
