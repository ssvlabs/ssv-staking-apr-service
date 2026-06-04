import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post
} from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags
} from '@nestjs/swagger';
import { LstSnapshotOrchestratorService } from '../services/lst-snapshot-orchestrator.service';
import { LstSnapshotReadService } from '../services/lst-snapshot-read.service';
import {
  LstSnapshotTriggerDto,
  LstSnapshotTriggerResponseDto
} from '../dto/lst-snapshot-trigger.dto';
import { LstEligibilityResponseDto } from '../dto/lst-eligibility-response.dto';

@ApiTags('lst-snapshot')
@Controller('lst-snapshot')
export class LstSnapshotController {
  constructor(
    private readonly readService: LstSnapshotReadService,
    private readonly orchestratorService: LstSnapshotOrchestratorService
  ) {}

  @Get('eligible/:walletAddress')
  @ApiOperation({
    summary: 'Check LST/LRT holder eligibility for the SSV Syndicate Boost',
    description:
      'Returns whether the wallet held any eligible LST/LRT token at the campaign snapshot block (Jun 5 2PM UTC), along with per-token balances.'
  })
  @ApiParam({
    name: 'walletAddress',
    description: 'Wallet address to look up (any valid Ethereum address format)'
  })
  @ApiOkResponse({ type: LstEligibilityResponseDto })
  async getEligibility(
    @Param('walletAddress') walletAddress: string
  ): Promise<LstEligibilityResponseDto> {
    return this.readService.getEligibility(walletAddress);
  }

  @Post('admin/trigger')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually trigger an LST holder snapshot',
    description:
      'Internal admin endpoint. Runs the holder snapshot at the given block (or latest block if omitted). Idempotent — safe to call multiple times for the same block.'
  })
  @ApiBody({ type: LstSnapshotTriggerDto })
  @ApiOkResponse({ type: LstSnapshotTriggerResponseDto })
  async triggerSnapshot(
    @Body() body: LstSnapshotTriggerDto
  ): Promise<LstSnapshotTriggerResponseDto> {
    void this.orchestratorService
      .runLocked('manual', body.blockNumber)
      .catch(() => undefined);

    return { accepted: true };
  }
}
