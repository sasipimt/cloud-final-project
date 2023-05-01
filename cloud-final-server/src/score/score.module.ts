import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RequestHistory } from '../schema/requestHistory.entity';
import { Score } from '../schema/score.entity';
import { ScoreBoard } from '../schema/scoreBoard.entity';
import { ScoreController } from './score.controller';
import { ScoreService } from './score.service';
import { HttpModule } from '@nestjs/axios';
import { UtilModule } from '../util/util.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RequestHistory, Score, ScoreBoard]),
    HttpModule,
    UtilModule,
  ],
  controllers: [ScoreController],
  providers: [ScoreService],
})
export class ScoreModule {}
