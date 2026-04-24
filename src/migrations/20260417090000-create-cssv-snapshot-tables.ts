import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCssvSnapshotTables20260417090000
  implements MigrationInterface
{
  name = 'CreateCssvSnapshotTables20260417090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cssv_snapshot_runs" (
        "id" bigserial PRIMARY KEY,
        "snapshot_date" date NOT NULL,
        "snapshot_time_utc" timestamptz NOT NULL,
        "previous_snapshot_block" bigint NOT NULL,
        "to_block_exclusive" bigint NOT NULL,
        "snapshot_state_block" bigint NOT NULL,
        "from_block_inclusive" bigint NOT NULL,
        "total_staked_wei_ssv" numeric(78,0) NOT NULL,
        "wallet_count" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "cssv_snapshot_runs_snapshot_date_key" UNIQUE ("snapshot_date")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cssv_snapshot_wallets" (
        "snapshot_run_id" bigint NOT NULL,
        "wallet_address" text NOT NULL,
        "balance_wei_ssv" numeric(78,0) NOT NULL,
        "gross_claimable_eth_wei" numeric(78,0) NOT NULL,
        "daily_reward_accrual_wei" numeric(78,0) NOT NULL,
        "claimed_in_window_wei" numeric(78,0) NOT NULL,
        "burned_dust_in_window_wei" numeric(78,0) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cssv_snapshot_wallets" PRIMARY KEY ("snapshot_run_id", "wallet_address"),
        CONSTRAINT "FK_cssv_snapshot_wallets_snapshot_run_id"
          FOREIGN KEY ("snapshot_run_id")
          REFERENCES "cssv_snapshot_runs"("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "cssv_snapshot_wallets_wallet_idx"
      ON "cssv_snapshot_wallets" ("wallet_address")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "cssv_snapshot_wallets_wallet_idx"'
    );
    await queryRunner.query('DROP TABLE IF EXISTS "cssv_snapshot_wallets"');
    await queryRunner.query('DROP TABLE IF EXISTS "cssv_snapshot_runs"');
  }
}
