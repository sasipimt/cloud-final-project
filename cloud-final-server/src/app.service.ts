import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RequestHistory } from './schema/requestHistory.entity';
import { Score } from './schema/score.entity';
import { ScoreBoard } from './schema/scoreBoard.entity';
import { Repository, DeleteResult, UpdateResult } from 'typeorm';
import { AudioRequestDto } from './dto/audioRequest.dto';
import { ScoreRequestDto } from './dto/scoreRequest.dto';

@Injectable()
export class AppService {
  constructor(
    @InjectRepository(RequestHistory)
    @InjectRepository(Score)
    @InjectRepository(ScoreBoard)
    private readonly requestHistoryRepository: Repository<RequestHistory>,
    private readonly scoreRepository: Repository<Score>,
    private readonly scoreBoardRepository: Repository<ScoreBoard>,
  ) {}
  getHello(): string {
    return 'Hello World!';
  }

  async getAudio(audioRequestDto: AudioRequestDto): Promise<RequestHistory> {
    const request: RequestHistory = new RequestHistory();
    request.userId = audioRequestDto.userId;
    request.audioNumber = audioRequestDto.audioNumber;

    const oldUserReq = await this.requestHistoryRepository.findOneBy({
      userId: request.userId,
    });

    if (oldUserReq !== null) {
      await this.requestHistoryRepository.update(oldUserReq.id, request);
    } else {
      await this.requestHistoryRepository.save(request);
    }

    return request;
  }

  async getScore(scoreRequestDto: ScoreRequestDto): Promise<string> {
    return 'Hello World!';
  }

  async getScoreBoard(audioNumber: string): Promise<Array<Score>> {
    let scoreBoard = [];
    const ranks = await this.scoreBoardRepository.findOneBy({
      audioNumber: audioNumber,
    });
    if (ranks !== null) {
      if (ranks.fisrtRank !== null) {
        const fisrtRank = await this.scoreRepository.findOneBy({
          id: ranks.fisrtRank,
        });
        scoreBoard.push(fisrtRank);
      }
      if (ranks.secondRank !== null) {
        const secondRank = await this.scoreRepository.findOneBy({
          id: ranks.secondRank,
        });
        scoreBoard.push(secondRank);
      }
      if (ranks.thirdRank !== null) {
        const thirdRank = await this.scoreRepository.findOneBy({
          id: ranks.thirdRank,
        });
        scoreBoard.push(thirdRank);
      }
    }
    return scoreBoard;
  }
}
