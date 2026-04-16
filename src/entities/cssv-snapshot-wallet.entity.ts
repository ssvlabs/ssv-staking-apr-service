import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn
} from 'typeorm';
import { CssvSnapshotRun } from './cssv-snapshot-run.entity';

@Entity('cssv_snapshot_wallets')
@Index('cssv_snapshot_wallets_wallet_idx', ['walletAddress'])
export class CssvSnapshotWallet {
  @PrimaryColumn({ name: 'snapshot_run_id', type: 'bigint' })
  snapshotRunId!: string;

  @PrimaryColumn({ name: 'wallet_address', type: 'text' })
  walletAddress!: string;

  @Column({ name: 'balance_wei_ssv', type: 'numeric', precision: 78, scale: 0 })
  balanceWeiSsv!: string;

  @Column({
    name: 'gross_claimable_eth_wei',
    type: 'numeric',
    precision: 78,
    scale: 0
  })
  grossClaimableEthWei!: string;

  @Column({
    name: 'daily_reward_accrual_wei',
    type: 'numeric',
    precision: 78,
    scale: 0
  })
  dailyRewardAccrualWei!: string;

  @Column({
    name: 'claimed_in_window_wei',
    type: 'numeric',
    precision: 78,
    scale: 0
  })
  claimedInWindowWei!: string;

  @Column({
    name: 'burned_dust_in_window_wei',
    type: 'numeric',
    precision: 78,
    scale: 0
  })
  burnedDustInWindowWei!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => CssvSnapshotRun, (snapshotRun) => snapshotRun.wallets, {
    onDelete: 'CASCADE'
  })
  @JoinColumn({ name: 'snapshot_run_id' })
  snapshotRun!: CssvSnapshotRun;
}
