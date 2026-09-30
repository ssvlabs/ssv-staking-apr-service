import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags
} from '@nestjs/swagger';
import { LstSnapshotReadService } from '../services/lst-snapshot-read.service';
import { LstEligibilityResponseDto } from '../dto/lst-eligibility-response.dto';

@ApiTags('lst-snapshot')
@Controller('lst-snapshot')
export class LstSnapshotReadController {
  constructor(private readonly readService: LstSnapshotReadService) {}

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
}
