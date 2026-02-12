import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AprController } from './controllers/apr.controller';
import { AprSample } from './entities/apr-sample.entity';
import { AprCalculationService } from './services/apr-calculation.service';
import { BlockchainService } from './services/blockchain.service';
import { CoinGeckoService } from './services/coingecko.service';
import { EcService } from './services/ec.service';
import { getDatabaseConfig } from './config/database.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env'
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: getDatabaseConfig,
      inject: [ConfigService]
    }),
    TypeOrmModule.forFeature([AprSample]),
    ScheduleModule.forRoot()
  ],
  controllers: [AprController],
  providers: [
    AprCalculationService,
    BlockchainService,
    CoinGeckoService,
    EcService
  ]
})
export class AppModule {}
