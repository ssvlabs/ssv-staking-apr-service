import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique
} from 'typeorm';

@Entity('lst_holder_snapshots')
@Unique('lst_holder_snapshots_unique', ['snapshotBlock', 'walletAddress', 'tokenAddress'])
@Index('lst_holder_snapshots_wallet_idx', ['walletAddress'])
@Index('lst_holder_snapshots_block_idx', ['snapshotBlock'])
export class LstHolderSnapshot {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'snapshot_block', type: 'bigint' })
  snapshotBlock!: string;

  @Column({ name: 'snapshot_at', type: 'timestamptz' })
  snapshotAt!: Date;

  @Column({ name: 'wallet_address', type: 'text' })
  walletAddress!: string;

  @Column({ name: 'token_address', type: 'text' })
  tokenAddress!: string;

  @Column({ name: 'token_symbol', type: 'text' })
  tokenSymbol!: string;

  @Column({ name: 'balance_wei', type: 'numeric', precision: 78, scale: 0 })
  balanceWei!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
