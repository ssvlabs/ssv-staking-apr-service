import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLstHolderSnapshot20260604140000 implements MigrationInterface {
  name = 'CreateLstHolderSnapshot20260604140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lst_holder_snapshots" (
        "id"             bigserial PRIMARY KEY,
        "snapshot_block" bigint NOT NULL,
        "snapshot_at"    timestamptz NOT NULL,
        "wallet_address" text NOT NULL,
        "token_address"  text NOT NULL,
        "token_symbol"   text NOT NULL,
        "balance_wei"    numeric(78,0) NOT NULL,
        "created_at"     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "lst_holder_snapshots_unique"
          UNIQUE ("snapshot_block", "wallet_address", "token_address")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "lst_holder_snapshots_wallet_idx"
      ON "lst_holder_snapshots" ("wallet_address")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "lst_holder_snapshots_block_idx"
      ON "lst_holder_snapshots" ("snapshot_block")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "lst_holder_snapshots_block_idx"');
    await queryRunner.query('DROP INDEX IF EXISTS "lst_holder_snapshots_wallet_idx"');
    await queryRunner.query('DROP TABLE IF EXISTS "lst_holder_snapshots"');
  }
}
