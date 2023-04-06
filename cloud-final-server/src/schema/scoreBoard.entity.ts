import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class ScoreBoard {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  audioNumber: string;

  @Column()
  fisrtRank: number;

  @Column()
  secondRank: number;

  @Column()
  thirdRank: number;
}
