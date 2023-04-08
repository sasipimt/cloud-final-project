import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class RequestHistory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: string;

  @Column()
  userDisplayName: string;

  @Column()
  audioNumber: string;
}
