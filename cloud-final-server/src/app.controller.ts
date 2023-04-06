import { Body, Controller, Get, Post, Req, Param } from '@nestjs/common';
import { AppService } from './app.service';
import { AudioRequestDto } from './dto/audioRequest.dto';
import { ScoreRequestDto } from './dto/scoreRequest.dto';
import { Score } from './schema/score.entity';
import { RequestHistory } from './schema/requestHistory.entity';

@Controller('/api')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  async getHello(): Promise<string> {
    return await this.appService.getHello();
  }

  @Post('/audio')
  async getAudio(
    @Body() audioRequestDto: AudioRequestDto,
  ): Promise<RequestHistory> {
    return await this.appService.getAudio(audioRequestDto);
  }

  @Post('/score')
  async getScore(@Body() scoreRequestDto: ScoreRequestDto) {
    return await this.appService.getScore(scoreRequestDto);
  }

  @Get('/scoreboard/:audioNumber')
  async getScoreBoard(@Param() audioNumber: string): Promise<Array<Score>> {
    return await this.appService.getScoreBoard(audioNumber);
  }
}
