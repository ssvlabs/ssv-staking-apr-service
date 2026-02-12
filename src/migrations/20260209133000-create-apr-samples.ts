import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAprSamplesTable20260209133000
  implements MigrationInterface
{
  name = 'CreateAprSamplesTable20260209133000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "apr_samples" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "timestamp" timestamp NOT NULL UNIQUE,
        "accEthPerShare" numeric(78,18) NOT NULL,
        "ethPrice" numeric(18,8) NOT NULL,
        "ssvPrice" numeric(18,8) NOT NULL,
        "currentApr" numeric(20,2),
        "aprProjected" numeric(20,2),
        "deltaIndex" numeric(78,18),
        "deltaTime" bigint,
        "createdAt" timestamp NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_apr_samples_timestamp" ON "apr_samples" ("timestamp")'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_apr_samples_timestamp"'
    );
    await queryRunner.query('DROP TABLE IF EXISTS "apr_samples"');
  }
}
