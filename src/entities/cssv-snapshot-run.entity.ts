import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn
} from 'typeorm';
import { CssvSnapshotWallet } from './cssv-snapshot-wallet.entity';

@Entity('cssv_snapshot_runs')
@Unique('cssv_snapshot_runs_snapshot_date_key', ['snapshotDate'])
export class CssvSnapshotRun {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'snapshot_date', type: 'date' })
  snapshotDate!: string;

  @Column({ name: 'snapshot_time_utc', type: 'timestamptz' })
  snapshotTimeUtc!: Date;

  @Column({ name: 'previous_snapshot_block', type: 'bigint' })
  previousSnapshotBlock!: string;

  @Column({ name: 'to_block_exclusive', type: 'bigint' })
  toBlockExclusive!: string;

  @Column({ name: 'snapshot_state_block', type: 'bigint' })
  snapshotStateBlock!: string;

  @Column({ name: 'from_block_inclusive', type: 'bigint' })
  fromBlockInclusive!: string;

  @Column({ name: 'total_staked_wei_ssv', type: 'numeric', precision: 78, scale: 0 })
  totalStakedWeiSsv!: string;

  @Column({ name: 'wallet_count', type: 'integer' })
  walletCount!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => CssvSnapshotWallet, (wallet) => wallet.snapshotRun)
  wallets!: CssvSnapshotWallet[];
}
