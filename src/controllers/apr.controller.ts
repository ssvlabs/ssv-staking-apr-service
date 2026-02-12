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

    const apr = await this.aprCalculationService.getCurrentApr();

    if (!apr) {
      return {
        currentApr: null,
        aprProjected: null,
        message:
          'No APR data available yet. Please wait for the first sample collection.'
      };
    }
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
    const samples = await this.aprCalculationService.getLatestTwoSamples();

    if (samples.length === 0) {
      return {
        samples: [],
        message: 'No samples available yet.'
      };
    }

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
    const sample = await this.aprCalculationService.manualCollectSample();

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