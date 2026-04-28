import { Injectable, Logger } from '@nestjs/common';
import { QueryRunner, DataSource } from 'typeorm';
import {
  CSSV_SNAPSHOT_LOCK_KEY,
  CSSV_SNAPSHOT_LOCK_NAMESPACE
} from '../constants/cssv-snapshot.constants';

@Injectable()
export class CssvSnapshotAdvisoryLockService {
  private readonly logger = new Logger(CssvSnapshotAdvisoryLockService.name);

  constructor(private readonly dataSource: DataSource) {}

  async tryAcquire(): Promise<QueryRunner | null> {
    // Keep the advisory lock on a dedicated connection for the full job duration.
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();

    try {
      const result = (await runner.query(
        'select pg_try_advisory_lock($1, $2) as locked',
        [CSSV_SNAPSHOT_LOCK_NAMESPACE, CSSV_SNAPSHOT_LOCK_KEY]
      )) as Array<{ locked: boolean | string }>;

      const locked = result[0]?.locked === true || result[0]?.locked === 't';

      if (!locked) {
        await runner.release();
        return null;
      }

      this.logger.debug('Acquired CSSV snapshot advisory lock');
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
          CSSV_SNAPSHOT_LOCK_NAMESPACE,
          CSSV_SNAPSHOT_LOCK_KEY
        ]);
      }
    } finally {
      if (!runner.isReleased) {
        await runner.release();
      }
    }

    this.logger.debug('Released CSSV snapshot advisory lock');
  }
}
