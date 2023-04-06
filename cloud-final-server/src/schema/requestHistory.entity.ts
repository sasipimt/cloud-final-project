import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class RequestHistory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: string;

  @Column()
  audioNumber: string;
}
