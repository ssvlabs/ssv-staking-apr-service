import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { validateEnvironment } from './config/env.validation';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  validateEnvironment(process.env);

  logger.log('Environment validation passed.');
  logger.log(`RPC configured: ${Boolean(process.env.RPC_URL)}`);
  
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'debug', 'verbose', 'warn', 'error']
  });

  // Enable CORS
  const corsOrigin = process.env.CORS_ORIGIN || '*';;
  app.enableCors({
    origin: corsOrigin,
    credentials: true
  });

  // Enable validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true
    })
  );
  // Set global prefix
  app.setGlobalPrefix('api');
  // Swagger configuration
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
