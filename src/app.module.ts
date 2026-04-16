import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AprController } from './controllers/apr.controller';
import { AprSample } from './entities/apr-sample.entity';
import { AprCalculationService } from './services/apr-calculation.service';
import { BlockchainService } from './services/blockchain.service';
import { CoinGeckoService } from './services/coingecko.service';
import { ExplorerCenterService } from './services/explorer-center.service';
import { OracleService } from './services/oracle.service';
import { getDatabaseConfig } from './config/database.config';
import { validateEnvironment } from './config/env.validation';
import { CssvSnapshotModule } from './cssv-snapshot/cssv-snapshot.module';

const cssvSnapshotEnabled = process.env.CSSV_SNAPSHOT_ENABLED === 'true';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: getDatabaseConfig,
      inject: [ConfigService]
    }),
    TypeOrmModule.forFeature([AprSample]),
    ScheduleModule.forRoot(),
    ...(cssvSnapshotEnabled ? [CssvSnapshotModule] : [])
  ],
  controllers: [AprController],
  providers: [
    AprCalculationService,
    BlockchainService,
    CoinGeckoService,
    ExplorerCenterService,
    OracleService
  ]
})
export class AppModule {}
