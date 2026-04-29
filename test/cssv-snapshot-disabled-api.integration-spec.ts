import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { CssvSnapshotDisabledController } from '../src/cssv-snapshot/controllers/cssv-snapshot-disabled.controller';

describe('CSSV snapshot disabled API integration', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [CssvSnapshotDisabledController]
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true
      })
    );
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('fails fast on wallet snapshots when the feature is disabled', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/apr/snapshots/0x1234567890abcdef1234567890abcdef12345678')
      .expect(503);

    expect(response.body.message).toBe(
      'CSSV snapshot feature is disabled for this deployment'
    );
  });

  it('fails fast on admin repair when the feature is disabled', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/apr/admin/snapshots/repair')
      .send({
        snapshotDate: 'not-even-a-date'
      })
      .expect(503);

    expect(response.body.message).toBe(
      'CSSV snapshot feature is disabled for this deployment'
    );
  });
});
