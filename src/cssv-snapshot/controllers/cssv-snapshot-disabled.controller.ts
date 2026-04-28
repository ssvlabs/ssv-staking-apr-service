import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  ServiceUnavailableException
} from '@nestjs/common';
import {
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags
} from '@nestjs/swagger';

@ApiTags('apr')
@Controller('apr')
export class CssvSnapshotDisabledController {
  @Get('snapshots/:ownerAddress')
  @ApiOperation({
    summary: 'Get daily CSSV snapshots for a wallet',
    description:
      'Returns 503 when the CSSV snapshot feature is disabled for this deployment.'
  })
  @ApiServiceUnavailableResponse({
    description: 'CSSV snapshot feature is disabled for this deployment.'
  })
  getWalletSnapshots(): never {
    throw new ServiceUnavailableException(
      'CSSV snapshot feature is disabled for this deployment'
    );
  }

  @Post('admin/snapshots/repair')
  @HttpCode(HttpStatus.SERVICE_UNAVAILABLE)
  @ApiOperation({
    summary: 'Repair CSSV snapshots from one business date',
    description:
      'Returns 503 when the CSSV snapshot feature is disabled for this deployment.'
  })
  @ApiServiceUnavailableResponse({
    description: 'CSSV snapshot feature is disabled for this deployment.'
  })
  repairSnapshots(): never {
    throw new ServiceUnavailableException(
      'CSSV snapshot feature is disabled for this deployment'
    );
  }
}
