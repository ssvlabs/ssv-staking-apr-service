import {
  Controller,
  Get,
  Post,
  Query,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  BadRequestException,
  Logger
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { AprCalculationService } from '../services/apr-calculation.service';

@ApiTags('apr')
@Controller('apr')
export class AprController {
  private readonly logger = new Logger(AprController.name);

  constructor(private readonly aprCalculationService: AprCalculationService) {
    this.logger.log('AprController initialized');
  }

  /**
   * GET /apr/current
   * Get the current APR calculation
   */
  @Get('current')
  @ApiOperation({
    summary: 'Get current APR',
    description: 'Returns the most recent APR calculation for SSV Network'
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved current APR',
    schema: {
      example: {
        currentApr: 5.67,
        aprProjected: 6.12,
        timestamp: '2025-01-15T12:00:00Z'
      }
    }
  })
  async getCurrentApr() {
    this.logger.log('GET /apr/current called');
    const startTime = Date.now();

    const apr = await this.aprCalculationService.getCurrentApr();
    const elapsed = Date.now() - startTime;

    if (!apr) {
      this.logger.warn(`GET /apr/current completed in ${elapsed}ms - no APR data available`);
      return {
        currentApr: null,
        aprProjected: null,
        message:
          'No APR data available yet. Please wait for the first sample collection.'
      };
    }

    this.logger.log(
      `GET /apr/current completed in ${elapsed}ms. apr=${apr.apr !== null ? apr.apr.toFixed(2) + '%' : 'null'}, aprProjected=${apr.aprProjected !== null ? apr.aprProjected.toFixed(2) + '%' : 'null'}`
    );
    return apr;
  }

  /**
   * GET /apr/latest
   * Get the two latest samples (as required by the UI spec)
   */
  @Get('latest')
  @ApiOperation({
    summary: 'Get latest samples',
    description: 'Returns the two most recent APR samples'
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved latest samples',
    schema: {
      example: {
        samples: [
          {
            id: 1,
            apr: 5.67,
            aprProjected: 6.12,
            timestamp: '2025-01-15T12:00:00Z',
            ssvPrice: 50.0,
            ethPrice: 2000.0,
            totalSupply: '1000000',
            networkFee: '0.01'
          }
        ],
        count: 2
      }
    }
  })
  async getLatestSamples() {
    this.logger.log('GET /apr/latest called');
    const startTime = Date.now();

    const samples = await this.aprCalculationService.getLatestTwoSamples();
    const elapsed = Date.now() - startTime;

    if (samples.length === 0) {
      this.logger.warn(`GET /apr/latest completed in ${elapsed}ms - no samples in DB`);
      return {
        samples: [],
        message: 'No samples available yet.'
      };
    }

    this.logger.log(`GET /apr/latest completed in ${elapsed}ms. Returned ${samples.length} samples`);
    return {
      samples,
      count: samples.length
    };
  }

  /**
   * GET /apr/history
   * Get historical APR samples
   * Query params: limit (default 30), startDate, endDate
   */
  @Get('history')
  @ApiOperation({
    summary: 'Get historical APR data',
    description:
      'Returns historical APR samples with optional filtering by date range and limit'
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of samples to return (default: 30)'
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    type: String,
    description: 'Start date for filtering (ISO 8601 format)'
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    type: String,
    description: 'End date for filtering (ISO 8601 format)'
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved historical data'
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid date format'
  })
  async getHistory(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    this.logger.log(
      `GET /apr/history called. params: limit=${limit || 'default(30)'}, startDate=${startDate || 'none'}, endDate=${endDate || 'none'}`
    );
    const startTime = Date.now();

    const parsedStartDate = startDate ? new Date(startDate) : undefined;
    const parsedEndDate = endDate ? new Date(endDate) : undefined;

    if (parsedStartDate && isNaN(parsedStartDate.getTime())) {
      this.logger.warn(`GET /apr/history - invalid startDate: "${startDate}"`);
      throw new BadRequestException('Invalid startDate format');
    }

    if (parsedEndDate && isNaN(parsedEndDate.getTime())) {
      this.logger.warn(`GET /apr/history - invalid endDate: "${endDate}"`);
      throw new BadRequestException('Invalid endDate format');
    }

    const samples = await this.aprCalculationService.getHistoricalSamples(
      limit || 30,
      parsedStartDate,
      parsedEndDate
    );

    const elapsed = Date.now() - startTime;
    this.logger.log(
      `GET /apr/history completed in ${elapsed}ms. Returned ${samples.length} samples`
    );

    return {
      samples,
      count: samples.length
    };
  }

  /**
   * POST /apr/collect
   * Manually trigger APR sample collection (for testing/admin)
   */
  @Post('collect')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Manually collect APR sample',
    description:
      'Triggers manual collection of APR data (for testing/admin purposes)'
  })
  @ApiResponse({
    status: 201,
    description: 'APR sample collected successfully',
    schema: {
      example: {
        message: 'APR sample collected successfully',
        sample: {
          id: 1,
          apr: 5.67,
          aprProjected: 6.12,
          timestamp: '2025-01-15T12:00:00Z',
          ssvPrice: 50.0,
          ethPrice: 2000.0
        }
      }
    }
  })
  async collectSample() {
    this.logger.log('POST /apr/collect called - manual collection triggered');
    const startTime = Date.now();

    const sample = await this.aprCalculationService.manualCollectSample();
    const elapsed = Date.now() - startTime;

    this.logger.log(
      `POST /apr/collect completed in ${elapsed}ms. Sample id: ${sample.id}`
    );

    return {
      message: 'APR sample collected successfully',
      sample
    };
  }

  /**
   * GET /apr/health
   * Health check endpoint
   */
  @Get('health')
  @ApiOperation({
    summary: 'Health check',
    description: 'Check if the service is running'
  })
  @ApiResponse({
    status: 200,
    description: 'Service is healthy',
    schema: {
      example: {
        status: 'ok'
      }
    }
  })
  healthCheck() {
    return {
      status: 'ok'
    };
  }
}