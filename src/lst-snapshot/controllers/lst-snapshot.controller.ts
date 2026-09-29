import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags
} from '@nestjs/swagger';
import { LstSnapshotOrchestratorService } from '../services/lst-snapshot-orchestrator.service';
import { AdminApiKeyGuard } from '../guards/admin-api-key.guard';
import {
  LstSnapshotTriggerDto,
  LstSnapshotTriggerResponseDto
} from '../dto/lst-snapshot-trigger.dto';

@ApiTags('lst-snapshot')
@Controller('lst-snapshot')
export class LstSnapshotController {
  private readonly logger = new Logger(LstSnapshotController.name);

  constructor(
    private readonly orchestratorService: LstSnapshotOrchestratorService
  ) {}

  @Post('admin/trigger')
  @UseGuards(AdminApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiHeader({
    name: 'x-admin-key',
    description: 'Admin API key (required when LST_ADMIN_API_KEY is set)',
    required: false
  })
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
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Manual LST snapshot trigger failed: ${message}`);
      });

    return { accepted: true };
  }
}
