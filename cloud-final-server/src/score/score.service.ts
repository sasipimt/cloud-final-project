import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RequestHistory } from '../schema/requestHistory.entity';
import { Score } from '../schema/score.entity';
import { Repository, DeleteResult, UpdateResult } from 'typeorm';
import { AudioRequestDto } from '../dto/audioRequest.dto';
import { ScoreRequestDto } from '../dto/scoreRequest.dto';
import { HttpService } from '@nestjs/axios';
import { Observable, firstValueFrom } from 'rxjs';
import { AxiosResponse, AxiosRequestConfig } from 'axios';
import { config } from 'process';
import { AudioResponseDto } from 'src/dto/audioResponse.dto';
import { ScoreResponseDto } from 'src/dto/scoreResponse.dto';
import {
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
} from '@aws-sdk/client-transcribe';
import { S3Client } from '@aws-sdk/client-s3';
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Client } from '@line/bot-sdk';
import { UtilService } from 'src/util/util.service';
import { resolve } from 'path';
import { SubmitRequestDto } from 'src/dto/submitRequest.dto';
import { SubmitResponseDto } from 'src/dto/submitResponse.dto';

const speech = require('@google-cloud/speech');
const line = require('@line/bot-sdk');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);
const { TranscribeClient } = require('@aws-sdk/client-transcribe');
require('dotenv').config();
const REGION = 'us-east-2';
const s3Client = new S3Client({ region: REGION });
const fileType = '.mp4';
const request = require('request-promise');
const LCS = require('lcs');
const toWav = require('audiobuffer-to-wav');

@Injectable()
export class ScoreService {
  constructor(
    @InjectRepository(RequestHistory)
    private readonly requestHistoryRepository: Repository<RequestHistory>,
    @InjectRepository(Score)
    private readonly scoreRepository: Repository<Score>,
    private readonly util: UtilService,
  ) {}
  private readonly scoreLogger = new Logger('ScoreService');
  async getUserDisplayName(userId: string) {
    const options = {
      method: 'GET',
      url: `https://api.line.me/v2/bot/profile/${userId}`,
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    };

    return request(options);
  }

  async getAudio(audioRequestDto: AudioRequestDto): Promise<AudioResponseDto> {
    const request: RequestHistory = new RequestHistory();
    request.userId = audioRequestDto.userId;
    request.audioNumber = audioRequestDto.audioNumber;

    const oldUserReq = await this.requestHistoryRepository.findOneBy({
      userId: audioRequestDto.userId,
    });

    if (oldUserReq !== null) {
      await this.requestHistoryRepository.update(oldUserReq.id, request);
    } else {
      const res = await this.getUserDisplayName(audioRequestDto.userId);
      const result = JSON.parse(res);

      request.userDisplayName = result.displayName;

      await this.requestHistoryRepository.save(request);
    }
    this.scoreLogger.log('requestEnd', JSON.stringify(request));

    return {
      audioUrl: `https://line-data-cloud.s3.us-east-2.amazonaws.com/${audioRequestDto.audioNumber}.m4a`,
    };
  }

  async submit(submitRequestDto: SubmitRequestDto): Promise<SubmitResponseDto> {
    const lineClient = new Client({
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
      channelSecret: process.env.LINE_CHANNEL_SECRET,
    });

    const fileName = `${submitRequestDto.messageId}`;
    const stream = await lineClient.getMessageContent(
      submitRequestDto.messageId,
    );

    const saveFile = () => {
      let writer = fs.createWriteStream(`${fileName}${fileType}`, {
        flags: 'a',
      });
      return new Promise((resolve) => {
        const x = stream
          .on('data', (chunk) => {
            writer.write(chunk);
          })
          .on('end', () => {
            writer.end();

            writer.on('finish', () => {
              resolve(x);
            });
          });
      });
    };
    await saveFile();

    const name = await this.s3Put(`${fileName}`);

    const jobName = await this.transcribe(submitRequestDto, name);
    this.util.replyProgress({
      jobName: jobName,
      replyToken: submitRequestDto.replyToken,
    });
    return { jobName };
  }

  async getScore(scoreRequestDto: ScoreRequestDto): Promise<ScoreResponseDto> {
    this.scoreLogger.log('start get score');
    const oldUserReq = await this.requestHistoryRepository.findOne({
      where: [{ userId: scoreRequestDto.userId }],
      order: { id: 'DESC' },
    });
    this.scoreLogger.log('oldUserReq', JSON.stringify(oldUserReq));
    const jobName = scoreRequestDto.jobName;

    const transcriptionStatus = await this.getTranscriptionStatus(jobName);

    if (transcriptionStatus !== 'COMPLETED') {
      this.scoreLogger.log('transcriptionStatus', transcriptionStatus);
      if (transcriptionStatus === 'FAILED') {
        this.scoreLogger.log('transcriptionStatus', transcriptionStatus);
        return {
          score: 0,
          transcription: 'TRANSCRIPTION FAILED',
          audioNumber: oldUserReq.audioNumber,
        };
      }

      this.util.replyProgress({
        jobName: jobName,
        replyToken: scoreRequestDto.replyToken,
      });
    } else {
      this.scoreLogger.log('transcriptionStatus', transcriptionStatus);
      const transcription = await this.s3GetObject(`${jobName}.json`);
      const transcriptionJSON = JSON.parse(transcription);
      let transcriptionWords = [];
      for (let item of transcriptionJSON.results.items) {
        if (item.type === 'pronunciation') {
          transcriptionWords.push(item.alternatives[0].content);
        }
      }
      // await this.s3DeleteObject(`${fileName}.mp4`);
      let words = '';
      transcriptionWords.map((w) => {
        words = words + w;
      });
      const sentence = this.util.getSentences(Number(oldUserReq.audioNumber));
      const lcs = new LCS(sentence, words);
      const score = Math.floor((lcs.getLength() * 100) / sentence.length);

      this.scoreLogger.log('test19', lcs.getLength());
      this.scoreLogger.log('score', score);
      this.scoreLogger.log('seq', lcs.getSequences());

      const oldUserScore = await this.scoreRepository.findOneBy({
        userId: scoreRequestDto.userId,
        audioNumber: oldUserReq.audioNumber,
      });
      let newScore = new Score();
      newScore.audioNumber = oldUserReq.audioNumber;
      newScore.userDisplayName = oldUserReq.userDisplayName;
      newScore.userId = oldUserReq.userId;
      newScore.userScore = score;
      // this.scoreLogger.log('oldUserReq', JSON.stringify(oldUserReq));
      if (oldUserScore !== null) {
        if (score > oldUserScore.userScore) {
          let newScore = new Score();
          newScore.audioNumber = oldUserScore.audioNumber;
          newScore.userDisplayName = oldUserScore.userDisplayName;
          newScore.userId = oldUserScore.userId;
          newScore.userScore = score;
          newScore.createdWhen = new Date();
          await this.scoreRepository.update(oldUserScore.id, newScore);
          this.scoreLogger.log('new High score', JSON.stringify(newScore));
        }
        this.scoreLogger.log('new score == old score');
      } else {
        await this.saveScore(scoreRequestDto.userId, score);
        this.scoreLogger.log('new score score', JSON.stringify(newScore));
      }
      // await this.s3DeleteObject(`${jobName}.json`);
      const scoreBoard = await this.getScoreBoard(oldUserReq.audioNumber);
      await this.util.replyScoreAndScoreBoard({
        ranking: scoreBoard,
        userId: scoreRequestDto.userId,
        replyToken: scoreRequestDto.replyToken,
        score: score.toString(),
        transcription: words,
        audioNumber: oldUserReq.audioNumber,
      });
      return {
        score: score,
        transcription: words,
        audioNumber: oldUserReq.audioNumber,
      };
    }
  }
  async getScoreBoard(audioNumber: string): Promise<Array<Score>> {
    this.scoreLogger.log('audioNumber: ', audioNumber);
    const scoreBoard = await this.scoreRepository
      .createQueryBuilder('score')
      .where('score.audioNumber = :audioNumber', { audioNumber: audioNumber })
      // .orderBy('Score.userScore', 'DESC')
      // .addOrderBy('Score.createdWhen', 'ASC')
      // .distinct(true)
      // .take(3)
      .getMany();
    this.scoreLogger.log('scoreBoard', scoreBoard);
    return scoreBoard;
  }

  async saveScore(userId: string, score: number) {
    const requestHistory = await this.requestHistoryRepository.findOne({
      where: [{ userId: userId }],
      order: { id: 'DESC' },
    });
    if (requestHistory.audioNumber !== null) {
      const newScore: Score = new Score();
      newScore.audioNumber = requestHistory.audioNumber;
      newScore.userId = userId;
      newScore.userDisplayName = requestHistory.userDisplayName;
      newScore.userScore = score;
      newScore.createdWhen = new Date();
      await this.scoreRepository.save(newScore);
    }
  }

  async s3Put(fileName: string) {
    const fileContent = fs.readFileSync(`${fileName}.mp4`);
    const s3Params = {
      Bucket: 'line-data-cloud',
      Key: `${fileName}.mp4`,
      Body: fileContent,
    };
    try {
      const results = await s3Client.send(new PutObjectCommand(s3Params));

      this.scoreLogger.log(
        'Successfully created ' +
          s3Params.Key +
          ' and uploaded it to ' +
          s3Params.Bucket +
          '/' +
          s3Params.Key,
      );
      this.scoreLogger.log('S3put', results);
      return fileName;
    } catch (err) {
      this.scoreLogger.log('Error', err);
    }
    fs.unlinkSync(`${fileName}.mp4`);
  }

  async transcribe(
    scoreRequestDto: SubmitRequestDto,
    fileName: string,
  ): Promise<string> {
    this.scoreLogger.log('test15');
    const params = {
      TranscriptionJobName: `TRANSCIBE_${scoreRequestDto.messageId}`,
      LanguageCode: 'th-TH',
      MediaFormat: 'mp4',
      Media: {
        MediaFileUri: `https://line-data-cloud.s3.us-east-2.amazonaws.com/${fileName}.mp4`,
      },
      OutputBucketName: 'line-data-cloud',
    };
    const transcribeClient = new TranscribeClient({ region: REGION });
    try {
      const data = await transcribeClient.send(
        new StartTranscriptionJobCommand(params),
      );

      this.scoreLogger.log('Success - put', data);
      // return { score: data }; // For unit tests.
      return `TRANSCIBE_${scoreRequestDto.messageId}`;
    } catch (err) {
      this.scoreLogger.log('Error', err);
    }
  }

  async getTranscriptionStatus(jobName: string): Promise<string> {
    const client = new TranscribeClient({ region: REGION });
    const input = {
      // GetTranscriptionJobRequest
      TranscriptionJobName: jobName, // required
    };
    const command = new GetTranscriptionJobCommand(input);
    const response = await client.send(command);
    return response.TranscriptionJob.TranscriptionJobStatus;
  }

  async s3GetObject(transciptionName: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: 'line-data-cloud',
      Key: transciptionName,
    });

    try {
      const response = await s3Client.send(command);
      // The Body object also has 'transformToByteArray' and 'transformToWebStream' methods.
      const str = await response.Body.transformToString();
      console.log(str);
      return str;
    } catch (err) {
      console.error(err);
    }
  }
  async s3DeleteObject(objName: string): Promise<string> {
    const command = new DeleteObjectCommand({
      Bucket: 'line-data-cloud',
      Key: objName,
    });

    try {
      const data = await s3Client.send(command);
      console.log('Success. Object deleted.', data);
      return 'Object deleted'; // For unit tests.
    } catch (err) {
      console.log('Error', err);
    }
    return 'err';
  }
}
