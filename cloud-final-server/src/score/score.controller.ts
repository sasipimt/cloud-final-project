import { Body, Controller, Get, Post, Req, Param } from '@nestjs/common';
import { AudioRequestDto } from '../dto/audioRequest.dto';
import { ScoreRequestDto } from '../dto/scoreRequest.dto';
import { Score } from '../schema/score.entity';
import { RequestHistory } from '../schema/requestHistory.entity';
import { ScoreService } from './score.service';

@Controller('/api')
export class ScoreController {
  constructor(private readonly scoreService: ScoreService) {}

  @Post('/audio')
  async getAudio(
    @Body() audioRequestDto: AudioRequestDto,
  ): Promise<RequestHistory> {
    return await this.scoreService.getAudio(audioRequestDto);
  }

  @Post('/score')
  async getScore(@Body() scoreRequestDto: ScoreRequestDto) {
    return await this.scoreService.getScore(scoreRequestDto);
  }

  @Get('/scoreboard/:audioNumber')
  async getScoreBoard(@Param() audioNumber: string): Promise<Array<Score>> {
    return await this.scoreService.getScoreBoard(audioNumber);
  }
}
