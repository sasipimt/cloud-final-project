import { Body, Controller, Get, Post, Req, Param } from '@nestjs/common';
import { AudioRequestDto } from '../dto/audioRequest.dto';
import { ScoreRequestDto } from '../dto/scoreRequest.dto';
import { Score } from '../schema/score.entity';
import { RequestHistory } from '../schema/requestHistory.entity';
import { ScoreService } from './score.service';
import { AudioResponseDto } from 'src/dto/audioResponse.dto';
import { SubmitRequestDto } from 'src/dto/submitRequest.dto';

@Controller('/api')
export class ScoreController {
  constructor(private readonly scoreService: ScoreService) {}

  @Post('/audio')
  async getAudio(
    @Body() audioRequestDto: AudioRequestDto,
  ): Promise<AudioResponseDto> {
    return await this.scoreService.getAudio(audioRequestDto);
  }

  @Post('/submit')
  async submit(@Body() submitRequestDto: SubmitRequestDto) {
    return await this.scoreService.submit(submitRequestDto);
  }

  @Post('/score')
  async getScore(@Body() scoreRequestDto: ScoreRequestDto) {
    return await this.scoreService.getScore(scoreRequestDto);
  }

  @Get('/scoreboard/:audioNumber')
  async getScoreBoard(@Param() audioNumber: number): Promise<Array<Score>> {
    return await this.scoreService.getScoreBoard(String(audioNumber));
  }
}
