import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  AprSample,
  CssvSnapshotRun,
  CssvSnapshotWallet
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
  entities: [AprSample, CssvSnapshotRun, CssvSnapshotWallet],
  migrations: [__dirname + '/../migrations/*.{ts,js}'],
  migrationsRun: configService.get<string>('TYPEORM_MIGRATIONS_RUN') === 'true',
  synchronize: false,
  logging: configService.get<string>('NODE_ENV') === 'development'
});
