import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RequestHistory } from '../schema/requestHistory.entity';
import { Score } from '../schema/score.entity';
import { ScoreBoard } from '../schema/scoreBoard.entity';
import { ScoreController } from './score.controller';
import { ScoreService } from './score.service';

@Module({
  imports: [TypeOrmModule.forFeature([RequestHistory, Score, ScoreBoard])],
  controllers: [ScoreController],
  providers: [ScoreService],
})
export class ScoreModule {}
