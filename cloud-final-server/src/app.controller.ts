import { Body, Controller, Get, Post, Req, Param } from '@nestjs/common';
import { AppService } from './app.service';
import { AudioRequestDto } from './dto/audioRequest.dto';
import { ScoreRequestDto } from './dto/scoreRequest.dto';
import { Score } from './schema/score.entity';
import { RequestHistory } from './schema/requestHistory.entity';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  async getHello(): Promise<string> {
    return await this.appService.getHello();
  }
}
