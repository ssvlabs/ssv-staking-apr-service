import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { LstHolderSnapshot } from '../entities/lst-holder-snapshot.entity';
import { LstSnapshotReadModule } from './lst-snapshot-read.module';
import { LstSnapshotOrchestratorService } from './services/lst-snapshot-orchestrator.service';

const CAMPAIGN_BLOCK = '25251631';
const WALLET = '0x7F6555C160D140833dd1Af58217D8A4C6547547F';
const LDO_ADDRESS = '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32';

describe('LstSnapshotReadModule', () => {
  let app: INestApplication<App>;
  const repositoryMock = {
    find: jest.fn(),
    createQueryBuilder: jest.fn()
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ LST_SNAPSHOT_CAMPAIGN_BLOCK: CAMPAIGN_BLOCK })]
        }),
        ScheduleModule.forRoot(),
        LstSnapshotReadModule
      ]
    })
      .overrideProvider(getRepositoryToken(LstHolderSnapshot))
      .useValue(repositoryMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('serves eligibility from the pinned campaign block', async () => {
    repositoryMock.find.mockResolvedValue([
      {
        tokenSymbol: 'LDO',
        tokenAddress: LDO_ADDRESS,
        balanceWei: '788659340000000000000'
      }
    ]);

    const response = await request(app.getHttpServer())
      .get(`/api/lst-snapshot/eligible/${WALLET.toLowerCase()}`)
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
    expect(repositoryMock.find).toHaveBeenCalledWith({
      where: { walletAddress: WALLET, snapshotBlock: CAMPAIGN_BLOCK }
    });
    expect(repositoryMock.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('rejects an invalid wallet address', async () => {
    await request(app.getHttpServer())
      .get('/api/lst-snapshot/eligible/not-an-address')
      .expect(400);
  });

  it('does not register the admin trigger route', async () => {
    await request(app.getHttpServer())
      .post('/api/lst-snapshot/admin/trigger')
      .send({})
      .expect(404);
  });

  it('does not register the snapshot cron or orchestrator', () => {
    expect(app.get(SchedulerRegistry).getCronJobs().size).toBe(0);
    expect(() =>
      app.get(LstSnapshotOrchestratorService, { strict: false })
    ).toThrow();
  });
});
