import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index
} from 'typeorm';

@Entity('apr_samples')
export class AprSample {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'timestamp', unique: true })
  @Index()
  timestamp: Date;

  @Column({ type: 'numeric', precision: 78, scale: 18 })
  accEthPerShare: string;

  @Column({ type: 'numeric', precision: 18, scale: 8 })
  ethPrice: string;

  @Column({ type: 'numeric', precision: 18, scale: 8 })
  ssvPrice: string;

  @Column({ type: 'numeric', precision: 20, scale: 2, nullable: true })
  currentApr: string | null;

  @Column({ type: 'numeric', precision: 20, scale: 2, nullable: true })
  aprProjected: string | null;

  @Column({ type: 'numeric', precision: 78, scale: 18, nullable: true })
  deltaIndex: string | null;

  @Column({ type: 'bigint', nullable: true })
  deltaTime: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
