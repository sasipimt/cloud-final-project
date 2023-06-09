import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Score {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  audioNumber: string;

  @Column()
  userId: string;

  @Column()
  userDisplayName: string;

  @Column()
  userScore: number;
}
