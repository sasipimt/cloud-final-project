import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RequestHistory } from '../schema/requestHistory.entity';
import { Score } from '../schema/score.entity';
import { ScoreBoard } from '../schema/scoreBoard.entity';
import { Repository, DeleteResult, UpdateResult } from 'typeorm';
import { AudioRequestDto } from '../dto/audioRequest.dto';
import { ScoreRequestDto } from '../dto/scoreRequest.dto';
import { HttpService } from '@nestjs/axios';
import { Observable, firstValueFrom } from 'rxjs';
import { AxiosResponse, AxiosRequestConfig } from 'axios';
import { config } from 'process';
import { AudioResponseDto } from 'src/dto/audioResponse.dto';
import { ScoreResponseDto } from 'src/dto/scoreResponse.dto';

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
    private readonly httpService: HttpService,
  ) {}
  private readonly scoreLogger = new Logger('ScoreService');
  async getUserDisplayName(userId: string): Promise<string> {
    const res = await firstValueFrom(
      this.httpService.get(`https://api.line.me/v2/bot/profile/${userId}`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      }),
    );
    if (res.data.hasOwnProperty('displayName')) {
      return res.data['displayName'];
    }
    return 'err';
  }

  async getAudio(audioRequestDto: AudioRequestDto): Promise<AudioResponseDto> {
    const request: RequestHistory = new RequestHistory();
    request.userId = audioRequestDto.userId;
    request.audioNumber = audioRequestDto.audioNumber;

    const oldUserReq = await this.requestHistoryRepository.findOneBy({
      userId: request.userId,
    });

    if (oldUserReq !== null) {
      await this.requestHistoryRepository.update(oldUserReq.id, request);
    } else {
      const displayName = await this.getUserDisplayName(request.userId);
      if (displayName !== 'err') {
        request.userDisplayName = displayName;
      }
      await this.requestHistoryRepository.save(request);
    }

    return {
      audioUrl: `https://line-data-cloud.s3.us-east-2.amazonaws.com/${audioRequestDto.audioNumber}.m4a`,
    };
  }

  async getScore(scoreRequestDto: ScoreRequestDto): Promise<ScoreResponseDto> {
    // const lineClient = new line.Client({
    //   channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    // });
    // let audioBytes;
    // let hasError = false;

    // lineClient.getMessageContent(scoreRequestDto.messageId).then((stream) => {
    //   stream.on('data', (chunk) => {
    //     audioBytes = chunk.toString('base64');
    //   });
    //   stream.on('error', (err) => {
    //     // error handling
    //     hasError = true;
    //     console.log(err);
    //   });
    // });

    // if (!hasError) {
    //   const client = new speech.SpeechClient();
    //   const audio = {
    //     content: audioBytes,
    //   };

    // const config = {
    //   encoding: 'LINEAR16',
    //   sampleRateHertz: 24000,
    //   languageCode: 'en-US',
    // };

    // const request = {
    //   audio,
    //   config,
    // };

    // const [response] = await client.recognize(request);
    // const transcription = response.results
    //   .map((result) => result.alternatives[0].transcript)
    //   .join('\n');
    // console.log(`Transcription: ${transcription}`);
    const client = new speech.SpeechClient();
    const gcsUri = 'gs://cloud-samples-data/speech/brooklyn_bridge.raw';

    // The audio file's encoding, sample rate in hertz, and BCP-47 language code
    const audio = {
      uri: gcsUri,
    };
    const config = {
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      languageCode: 'en-US',
    };
    const request = {
      audio: audio,
      config: config,
    };

    // Detects speech in the audio file
    const [response] = await client.recognize(request);
    this.scoreLogger.log('response:', response);
    const transcription = response.results
      .map((result) => result.alternatives[0].transcript)
      .join('\n');
    console.log(`Transcription: ${transcription}`);
    this.scoreLogger.log('Transcription:', transcription);
    return { score: `Transcription: ${transcription}` };
    // return { score: '0' };
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
