import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdjustAprClusterStatsScale20260427090400 implements MigrationInterface {
  name = 'AdjustAprClusterStatsScale20260427090400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "apr_samples"
        ADD COLUMN IF NOT EXISTS "totalActiveClusters" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "ethClusters" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "ssvClusters" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "totalEffectiveBalance" numeric(78,0) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "totalEthEffectiveBalance" numeric(78,0) NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "apr_samples"
        DROP COLUMN IF EXISTS "totalEthEffectiveBalance",
        DROP COLUMN IF EXISTS "totalEffectiveBalance",
        DROP COLUMN IF EXISTS "ssvClusters",
        DROP COLUMN IF EXISTS "ethClusters",
        DROP COLUMN IF EXISTS "totalActiveClusters"
    `);
  }
}
