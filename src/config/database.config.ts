import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  AprSample,
  CssvSnapshotRun,
  CssvSnapshotWallet,
  LstHolderSnapshot
} from '../entities';

export const getDatabaseConfig = (
  configService: ConfigService
): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: configService.get<string>('DATABASE_HOST'),
  port: configService.get<number>('DATABASE_PORT'),
  username: configService.get<string>('DATABASE_USER'),
  password: configService.get<string>('DATABASE_PASSWORD'),
  database: configService.get<string>('DATABASE_NAME'),
  entities: [AprSample, CssvSnapshotRun, CssvSnapshotWallet, LstHolderSnapshot],
  migrations: [__dirname + '/../migrations/*.{ts,js}'],
  migrationsRun: true,
  synchronize: false,
  logging: ['warn', 'error']
});
