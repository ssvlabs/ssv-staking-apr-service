import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  logger.log('=== SSV APR Service starting up ===');
  logger.debug(`Node version: ${process.version}`);
  logger.debug(`Platform: ${process.platform}`);
  logger.debug(`Architecture: ${process.arch}`);
  logger.debug(`PID: ${process.pid}`);
  logger.debug(`CWD: ${process.cwd()}`);

  // Log env config
  logger.log(`NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
  logger.log(`PORT: ${process.env.PORT || '3000 (default)'}`);
  logger.log(`CORS_ORIGIN: ${process.env.CORS_ORIGIN || '* (default)'}`);
  logger.log(`DATABASE_HOST: ${process.env.DATABASE_HOST || 'not set'}`);
  logger.log(`DATABASE_PORT: ${process.env.DATABASE_PORT || 'not set'}`);
  logger.log(`DATABASE_NAME: ${process.env.DATABASE_NAME || 'not set'}`);
  logger.log(`DATABASE_USER: ${process.env.DATABASE_USER || 'not set'}`);
  logger.log(`RPC_URL: ${process.env.RPC_URL || 'not set'}`);
  logger.log(
    `VIEWS_CONTRACT_ADDRESS: ${process.env.VIEWS_CONTRACT_ADDRESS || 'not set'}`
  );
  logger.log(
    `COINGECKO_API_URL: ${process.env.COINGECKO_API_URL || 'https://api.coingecko.com/api/v3 (default)'}`
  );
  logger.log(
    `EXPLORER_CENTER_HOODI: ${process.env.EXPLORER_CENTER_HOODI || 'not set'}`
  );
  logger.log(
    `APR_CALCULATION_CRON: ${process.env.APR_CALCULATION_CRON || 'not set (using every 3 hours)'}`
  );

  logger.log('Creating NestJS application...');
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'debug', 'verbose', 'warn', 'error']
  });
  logger.log('NestJS application created');

  // Enable CORS
  const corsOrigin = process.env.CORS_ORIGIN || '*';
  logger.log(`Enabling CORS with origin: ${corsOrigin}`);
  app.enableCors({
    origin: corsOrigin,
    credentials: true
  });

  // Enable validation
  logger.log('Enabling global validation pipe');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true
    })
  );

  // Set global prefix
  logger.log('Setting global API prefix: /api');
  app.setGlobalPrefix('api');

  // Swagger configuration
  logger.log('Configuring Swagger documentation');
  const config = new DocumentBuilder()
    .setTitle('SSV APR Service API')
    .setDescription('API for SSV Network APR calculations and historical data')
    .setVersion('1.0')
    .addTag('apr', 'APR calculation endpoints')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  logger.log(`Starting HTTP server on port ${port}`);
  await app.listen(port);

  logger.log('=== SSV APR Service is UP and RUNNING ===');
  logger.log(`Application is running on: http://localhost:${port}/api`);
  logger.log(`Swagger UI available at: http://localhost:${port}/api/docs`);
  logger.log(`Health check: http://localhost:${port}/api/apr/health`);
}
void bootstrap();
