import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RequestHistory } from '../schema/requestHistory.entity';
import { Score } from '../schema/score.entity';
import { ScoreBoard } from '../schema/scoreBoard.entity';
import { Repository, DeleteResult, UpdateResult } from 'typeorm';
import { AudioRequestDto } from '../dto/audioRequest.dto';
import { ScoreRequestDto } from '../dto/scoreRequest.dto';

const speech = require('@google-cloud/speech');
const line = require('@line/bot-sdk');
require('dotenv').config();

@Injectable()
export class ScoreService {
  constructor(
    @InjectRepository(RequestHistory)
    private readonly requestHistoryRepository: Repository<RequestHistory>,
    @InjectRepository(Score)
    private readonly scoreRepository: Repository<Score>,
    @InjectRepository(ScoreBoard)
    private readonly scoreBoardRepository: Repository<ScoreBoard>,
  ) {}

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
    const lineClient = new line.Client({
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    });
    let audioBytes;
    let hasError = false;

    lineClient.getMessageContent(scoreRequestDto.messageId).then((stream) => {
      stream.on('data', (chunk) => {
        audioBytes = chunk.toString('base64');
      });
      stream.on('error', (err) => {
        // error handling
        hasError = true;
        console.log(err);
      });
    });

    if (!hasError) {
      const client = new speech.SpeechClient();
      const audio = {
        content: audioBytes,
      };

      const config = {
        encoding: 'LINEAR16',
        sampleRateHertz: 24000,
        languageCode: 'en-US',
      };

      const request = {
        audio,
        config,
      };

      const [response] = await client.recognize(request);
      const transcription = response.results
        .map((result) => result.alternatives[0].transcript)
        .join('\n');
      console.log(`Transcription: ${transcription}`);
    }

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
