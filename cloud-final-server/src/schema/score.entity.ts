import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Score {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  audioNumber: string;

  @Column()
  fisrtRankUserId: string;

  @Column()
  fisrtRankScore: number;
}
