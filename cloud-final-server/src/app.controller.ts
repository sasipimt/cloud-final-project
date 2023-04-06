import { Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';

const API = '';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Post()
  getAudio(): string {
    return this.appService.getAudio();
  }
}
