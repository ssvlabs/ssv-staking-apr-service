import { Injectable, Logger } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import {
  LST_SNAPSHOT_LOCK_KEY,
  LST_SNAPSHOT_LOCK_NAMESPACE
} from '../constants/lst-snapshot.constants';

@Injectable()
export class LstSnapshotAdvisoryLockService {
  private readonly logger = new Logger(LstSnapshotAdvisoryLockService.name);

  constructor(private readonly dataSource: DataSource) {}

  async tryAcquire(): Promise<QueryRunner | null> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();

    try {
      const result = (await runner.query(
        'select pg_try_advisory_lock($1, $2) as locked',
        [LST_SNAPSHOT_LOCK_NAMESPACE, LST_SNAPSHOT_LOCK_KEY]
      )) as Array<{ locked: boolean | string }>;

      const locked = result[0]?.locked === true || result[0]?.locked === 't';

      if (!locked) {
        await runner.release();
        return null;
      }

      this.logger.debug('Acquired LST snapshot advisory lock');
      return runner;
    } catch (error) {
      await runner.release();
      throw error;
    }
  }

  async release(runner: QueryRunner | null | undefined): Promise<void> {
    if (!runner) {
      return;
    }

    try {
      if (!runner.isReleased) {
        await runner.query('select pg_advisory_unlock($1, $2)', [
          LST_SNAPSHOT_LOCK_NAMESPACE,
          LST_SNAPSHOT_LOCK_KEY
        ]);
      }
    } finally {
      if (!runner.isReleased) {
        await runner.release();
      }
    }

    this.logger.debug('Released LST snapshot advisory lock');
  }
}
