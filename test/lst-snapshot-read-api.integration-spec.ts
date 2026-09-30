import { INestApplication, Type } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { LstHolderSnapshot } from '../src/entities';
import { CreateLstHolderSnapshot20260604140000 } from '../src/migrations/20260604140000-create-lst-holder-snapshot';
import { LstSnapshotModule } from '../src/lst-snapshot/lst-snapshot.module';
import { LstSnapshotBlockchainService } from '../src/lst-snapshot/services/lst-snapshot-blockchain.service';
import { LstSnapshotOrchestratorService } from '../src/lst-snapshot/services/lst-snapshot-orchestrator.service';
import { LstSnapshotWriterService } from '../src/lst-snapshot/services/lst-snapshot-writer.service';
import { LstEligibilityResult } from '../src/lst-snapshot/types/lst-snapshot.types';

const CAMPAIGN_BLOCK = '25251631';
const EARLIER_BLOCK = '25000000';
const WALLET = '0x7F6555C160D140833dd1Af58217D8A4C6547547F';
const OTHER_WALLET = '0x1234567890AbcdEF1234567890aBcdef12345678';
const LDO_ADDRESS = '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32';
const STETH_ADDRESS = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84';

describe('LST snapshot read API integration', () => {
  let container: StartedTestContainer;

  const databaseEnv = () => ({
    DATABASE_HOST: container.getHost(),
    DATABASE_PORT: String(container.getMappedPort(5432)),
    DATABASE_USER: 'ssv_user',
    DATABASE_PASSWORD: 'ssv_password',
    DATABASE_NAME: 'ssv_apr_lst_test'
  });

  const seedSnapshot = async (dataSource: DataSource): Promise<void> => {
    const repository = dataSource.getRepository(LstHolderSnapshot);
    await dataSource.query('TRUNCATE TABLE "lst_holder_snapshots"');
    await repository.insert([
      {
        snapshotBlock: CAMPAIGN_BLOCK,
        snapshotAt: new Date('2026-06-05T13:59:47Z'),
        walletAddress: WALLET,
        tokenAddress: LDO_ADDRESS,
        tokenSymbol: 'LDO',
        balanceWei: '788659340000000000000'
      },
      {
        snapshotBlock: CAMPAIGN_BLOCK,
        snapshotAt: new Date('2026-06-05T13:59:47Z'),
        walletAddress: OTHER_WALLET,
        tokenAddress: STETH_ADDRESS,
        tokenSymbol: 'stETH',
        balanceWei: '1'
      },
      // An earlier, non-campaign block: the pin must win over MIN(snapshot_block).
      {
        snapshotBlock: EARLIER_BLOCK,
        snapshotAt: new Date('2026-05-20T00:00:00Z'),
        walletAddress: WALLET,
        tokenAddress: STETH_ADDRESS,
        tokenSymbol: 'stETH',
        balanceWei: '123456789012345678901234567890'
      }
    ]);
  };

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_DB: 'ssv_apr_lst_test',
        POSTGRES_USER: 'ssv_user',
        POSTGRES_PASSWORD: 'ssv_password'
      })
      .withExposedPorts(5432)
      .withWaitStrategy(
        Wait.forLogMessage(/database system is ready to accept connections/i, 2)
      )
      .withStartupTimeout(120_000)
      .start();
  });

  afterAll(async () => {
    if (container) {
      await container.stop();
    }
  });

  describe('AppModule in read mode', () => {
    let app: INestApplication<App>;
    let dataSource: DataSource;
    const originalEnv = process.env;

    beforeAll(async () => {
      process.env = {
        ...originalEnv,
        ...databaseEnv(),
        NODE_ENV: 'test',
        // Placeholder value makes BlockchainService skip its RPC connection.
        RPC_URL: 'http://YOUR_RPC_URL',
        VIEWS_CONTRACT_ADDRESS: '0xafE830B6Ee262ba11cce5F32fDCd760FFE6a66e4',
        STAKING_CONTRACT_ADDRESS: '0xDD9BC35aE942eF0cFa76930954a156B3fF30a4E1',
        EXPLORER_CENTER_URL: 'http://localhost:1/api/v4/mainnet',
        ORACLE_URL: 'http://localhost:1',
        CSSV_SNAPSHOT_ENABLED: 'false',
        LST_SNAPSHOT_ENABLED: 'false',
        LST_SNAPSHOT_READ_ENABLED: 'true',
        LST_SNAPSHOT_CAMPAIGN_BLOCK: CAMPAIGN_BLOCK
      };
      delete process.env.ARCHIVE_RPC_URL;
      delete process.env.CHAIN_ID;

      // app.module reads the feature flags at import time, so load it after
      // the environment is in place.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { AppModule } = require('../src/app.module') as {
        AppModule: Type<unknown>;
      };

      const moduleFixture = await Test.createTestingModule({
        imports: [AppModule]
      }).compile();

      app = moduleFixture.createNestApplication();
      app.setGlobalPrefix('api');
      await app.init();

      dataSource = moduleFixture.get(DataSource);
      await seedSnapshot(dataSource);
    });

    afterAll(async () => {
      if (app) {
        await app.close();
      }
      process.env = originalEnv;
    });

    const countSnapshotRows = async (): Promise<number> => {
      const [row] = await dataSource.query<{ count: number }[]>(
        'SELECT count(*)::int AS count FROM "lst_holder_snapshots"'
      );
      return row.count;
    };

    it.each([WALLET, WALLET.toLowerCase()])(
      'serves the campaign snapshot for %s',
      async (address) => {
        const response = await request(app.getHttpServer())
          .get(`/api/lst-snapshot/eligible/${address}`)
          .expect(200);

        expect(response.body).toEqual({
          walletAddress: WALLET,
          eligible: true,
          snapshotBlock: CAMPAIGN_BLOCK,
          tokens: [
            {
              symbol: 'LDO',
              tokenAddress: LDO_ADDRESS,
              balanceWei: '788659340000000000000'
            }
          ]
        });
      }
    );

    it('reports a wallet absent from the snapshot as not eligible', async () => {
      const response = await request(app.getHttpServer())
        .get(
          '/api/lst-snapshot/eligible/0x9999999999999999999999999999999999999999'
        )
        .expect(200);

      expect(response.body).toEqual({
        walletAddress: '0x9999999999999999999999999999999999999999',
        eligible: false,
        snapshotBlock: CAMPAIGN_BLOCK,
        tokens: []
      });
    });

    it('rejects an invalid wallet address', async () => {
      await request(app.getHttpServer())
        .get('/api/lst-snapshot/eligible/not-an-address')
        .expect(400);
    });

    it('does not expose the admin trigger', async () => {
      await request(app.getHttpServer())
        .post('/api/lst-snapshot/admin/trigger')
        .send({ blockNumber: 25300000 })
        .expect(404);
    });

    it('loads none of the capture providers', () => {
      for (const provider of [
        LstSnapshotOrchestratorService,
        LstSnapshotBlockchainService,
        LstSnapshotWriterService
      ]) {
        expect(() => app.get(provider, { strict: false })).toThrow();
      }
    });

    it('never writes to the snapshot table', async () => {
      const before = await countSnapshotRows();

      await request(app.getHttpServer())
        .get(`/api/lst-snapshot/eligible/${WALLET}`)
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/lst-snapshot/admin/trigger')
        .send({})
        .expect(404);

      const after = await countSnapshotRows();
      expect(after).toBe(before);
      expect(before).toBe(3);
    });

    it('keeps the existing APR routes working', async () => {
      // apr/latest reads only the database; apr/current calls CoinGecko.
      await request(app.getHttpServer()).get('/api/apr/latest').expect(200);
    });
  });

  describe('LstSnapshotModule (full capture mode)', () => {
    let app: INestApplication<App>;
    const orchestratorMock = {
      runLocked: jest.fn().mockResolvedValue(undefined)
    };

    beforeAll(async () => {
      const env = databaseEnv();
      const moduleFixture = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [
              () => ({
                ARCHIVE_RPC_URL: 'http://localhost:1',
                CHAIN_ID: '1',
                LST_SNAPSHOT_CAMPAIGN_BLOCK: CAMPAIGN_BLOCK
              })
            ]
          }),
          TypeOrmModule.forRoot({
            type: 'postgres',
            host: env.DATABASE_HOST,
            port: Number(env.DATABASE_PORT),
            username: env.DATABASE_USER,
            password: env.DATABASE_PASSWORD,
            database: env.DATABASE_NAME,
            entities: [LstHolderSnapshot],
            migrations: [CreateLstHolderSnapshot20260604140000],
            migrationsRun: true,
            synchronize: false
          }),
          ScheduleModule.forRoot(),
          LstSnapshotModule
        ]
      })
        .overrideProvider(LstSnapshotBlockchainService)
        .useValue({})
        .overrideProvider(LstSnapshotOrchestratorService)
        .useValue(orchestratorMock)
        .compile();

      app = moduleFixture.createNestApplication();
      app.setGlobalPrefix('api');
      await app.init();

      await seedSnapshot(moduleFixture.get(DataSource));
    });

    afterAll(async () => {
      if (app) {
        await app.close();
      }
    });

    it('still serves eligibility through the shared read module', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/lst-snapshot/eligible/${WALLET}`)
        .expect(200);

      const body = response.body as LstEligibilityResult;
      expect(body.snapshotBlock).toBe(CAMPAIGN_BLOCK);
      expect(body.tokens).toHaveLength(1);
    });

    it('still registers the admin trigger', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/lst-snapshot/admin/trigger')
        .send({ blockNumber: 25300000 })
        .expect(200);

      expect(response.body).toEqual({ accepted: true });
      expect(orchestratorMock.runLocked).toHaveBeenCalledWith(
        'manual',
        25300000
      );
    });
  });
});
