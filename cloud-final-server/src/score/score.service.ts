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
import { workerData } from 'worker_threads';

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
const { Worker, isMainThread, parentPort } = require('worker_threads');
let jobQ: Array<Q> = [];
@Injectable()
export class ScoreService {
  constructor(
    @InjectRepository(RequestHistory)
    private readonly requestHistoryRepository: Repository<RequestHistory>,
    @InjectRepository(Score)
    private readonly scoreRepository: Repository<Score>,
    @InjectRepository(ScoreBoard)
    private readonly scoreBoardRepository: Repository<ScoreBoard>, // private readonly httpService: HttpService,
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
    // this.scoreLogger.log('RequestHistory', JSON.stringify(request));
    const oldUserReq = await this.requestHistoryRepository.findOneBy({
      userId: audioRequestDto.userId,
    });
    // this.scoreLogger.log('oldUserReq', JSON.stringify(oldUserReq));
    if (oldUserReq !== null) {
      await this.requestHistoryRepository.update(oldUserReq.id, request);
    } else {
      const res = await this.getUserDisplayName(audioRequestDto.userId);
      const result = JSON.parse(res);
      // this.scoreLogger.log('displayName', result.displayName);

      request.userDisplayName = result.displayName;

      await this.requestHistoryRepository.save(request);
    }
    this.scoreLogger.log('requestEnd', JSON.stringify(request));

    return {
      audioUrl: `https://line-data-cloud.s3.us-east-2.amazonaws.com/${audioRequestDto.audioNumber}.m4a`,
    };
  }

  async getScore(scoreRequestDto: ScoreRequestDto) {
    this.scoreLogger.log('getScore: start');
    this.scoreLogger.log('messageId', scoreRequestDto.messageId);
    this.scoreLogger.log('userId', scoreRequestDto.userId);
    this.scoreLogger.log('token', scoreRequestDto.replyToken);
    const lineClient = new Client({
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
      channelSecret: process.env.LINE_CHANNEL_SECRET,
    });
    let audioBytes;

    const fileName = `${scoreRequestDto.messageId}`;
    const stream = await lineClient.getMessageContent(
      scoreRequestDto.messageId,
    );
    this.scoreLogger.log('test1');

    const saveFile = () => {
      let writer = fs.createWriteStream(`${fileName}${fileType}`, {
        flags: 'a',
      });
      return new Promise((resolve) => {
        this.scoreLogger.log('test1.5');
        const x = stream
          .on('data', (chunk) => {
            writer.write(chunk);
            this.scoreLogger.log('test2');
          })
          .on('end', () => {
            this.scoreLogger.log('test2.3');
            writer.end();
            this.scoreLogger.log('test2.4');
            writer.on('finish', () => {
              this.scoreLogger.log('test2.5');
              resolve(x);
            });
          });
      });
    };
    await saveFile();

    this.scoreLogger.log('test4');
    this.scoreLogger.log('test9');
    const name = await this.s3Put(`${fileName}`);
    this.scoreLogger.log('test14');
    const jobName = await this.transcribe(scoreRequestDto, name);
    this.scoreLogger.log('test18');
    const oldUserReq = await this.requestHistoryRepository.findOne({
      where: [{ userId: scoreRequestDto.userId }],
      order: { id: 'DESC' },
    });
    this.scoreLogger.log('oldUserReq', JSON.stringify(oldUserReq));
    this.scoreLogger.log('test18.1');
    // await this.sleep(60000);
    jobQ.push({ jobName, oldUserReq, fileName, scoreRequestDto });
    if (isMainThread) {
      const threadCount = +process.argv[2] || 2;
      this.scoreLogger.log('threadCount:', threadCount);
      const threads = new Set<any>();
      for (let i = 0; i < threadCount - 1; i++) {
        this.scoreLogger.log('new Worker');
        threads.add(new Worker(__filename, { workerData: jobQ }));
        jobQ = [];
      }

      for (let worker of threads) {
        worker.on('error', (err) => {
          throw err;
        });
        worker.on('exit', () => {
          threads.delete(worker);
          console.log(`Thread exiting, ${threads.size} running...`);
          if (threads.size === 0) {
            this.scoreLogger.log('threads.size === 0');
          }
        });
        worker.on('message', (msg) => {
          this.scoreLogger.log(msg);
        });
      }
    } else {
      waitTranscribe(workerData.jobQ);
    }
  }
  async createWorker(raw) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: raw,
      });
      worker.on('message', resolve);
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  }

  sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  async getScoreBoard(audioNumber: string): Promise<Array<Score>> {
    const scoreBoard = await this.scoreRepository
      .createQueryBuilder('Score')
      .where((audioNumber = audioNumber))
      .orderBy('userScore', 'DESC')
      .distinct(true)
      .take(3)
      .getMany();
    return scoreBoard;
  }

  async saveScore(userId: string, score: number) {
    const requestHistory = await this.requestHistoryRepository.findOne({
      where: [{ userId: userId }],
      order: { id: 'DESC' },
    });
    if (requestHistory.audioNumber !== null) {
      const ranks = await this.scoreBoardRepository.findOneBy({
        audioNumber: requestHistory.audioNumber,
      });

      const newScore: Score = new Score();
      newScore.audioNumber = requestHistory.audioNumber;
      newScore.userId = userId;
      newScore.userDisplayName = requestHistory.userDisplayName;
      newScore.userScore = score;
      this.scoreRepository.save(newScore);
    }
  }

  async s3Put(fileName: string) {
    this.scoreLogger.log('test10');
    const fileContent = fs.readFileSync(`${fileName}.mp4`);
    const s3Params = {
      Bucket: 'line-data-cloud', // The name of the bucket. For example, 'sample-bucket-101'.
      Key: `${fileName}.mp4`, // The name of the object. For example, 'sample_upload.txt'.
      Body: fileContent, // The content of the object. For example, 'Hello world!".
    };
    try {
      this.scoreLogger.log('test11');
      const results = await s3Client.send(new PutObjectCommand(s3Params));
      this.scoreLogger.log('test12');
      this.scoreLogger.log(
        'Successfully created ' +
          s3Params.Key +
          ' and uploaded it to ' +
          s3Params.Bucket +
          '/' +
          s3Params.Key,
      );
      this.scoreLogger.log('S3put', results);
      this.scoreLogger.log('test13');
      // return results; // For unit tests.
      return fileName;
    } catch (err) {
      this.scoreLogger.log('Error', err);
    }
    fs.unlinkSync(`${fileName}.mp4`);
  }

  async transcribe(
    scoreRequestDto: ScoreRequestDto,
    fileName: string,
  ): Promise<string> {
    this.scoreLogger.log('test15');
    const params = {
      TranscriptionJobName: `TRANSCIBE_${scoreRequestDto.messageId}`,
      LanguageCode: 'th-TH', // For example, 'en-US'
      MediaFormat: 'mp4', // For example, 'wav'
      Media: {
        MediaFileUri: `https://line-data-cloud.s3.us-east-2.amazonaws.com/${fileName}.mp4`,
        // For example, "https://transcribe-demo.s3-REGION.amazonaws.com/hello_world.wav"
      },
      OutputBucketName: 'line-data-cloud',
    };
    const transcribeClient = new TranscribeClient({ region: REGION });
    try {
      this.scoreLogger.log('test16');
      const data = await transcribeClient.send(
        new StartTranscriptionJobCommand(params),
      );
      this.scoreLogger.log('test17');
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

interface Q {
  jobName: string;
  oldUserReq: RequestHistory;
  fileName: string;
  scoreRequestDto: ScoreRequestDto;
}
async function waitTranscribe(arg: Array<Q>) {
  this.scoreLogger.log('Start waitTranscribe');
  let status: Array<boolean> = [];
  for (let i = 0; i < arg.length; i++) {
    status.push(false);
  }
  while (!status.every(Boolean)) {
    for (let jobIdx = 0; jobIdx < arg.length; jobIdx++) {
      if (status[jobIdx]) {
        continue;
      }
      this.scoreLogger.log('test18.2');
      let transcriptionStatus = await this.getTranscriptionStatus(
        arg[jobIdx].jobName,
      );
      this.scoreLogger.log('test18.3', transcriptionStatus);
      if (transcriptionStatus === 'FAILED') {
        status[jobIdx] = true;
        continue;
      }

      if (transcriptionStatus === 'COMPLETED') {
        status[jobIdx] = true;

        const transcription = await this.s3GetObject(
          `${arg[jobIdx].jobName}.json`,
        );
        const transcriptionJSON = JSON.parse(transcription);
        let transcriptionWords = [];
        for (let item of transcriptionJSON.results.items) {
          if (item.type === 'pronunciation') {
            transcriptionWords.push(item.alternatives[0].content);
          }
        }
        await this.s3DeleteObject(`${arg[jobIdx].fileName}.mp4`);
        let words = '';
        transcriptionWords.map((w) => {
          words = words + w;
        });
        const p = 'นี่คือข้อหนึ่ง';
        const lcs = new LCS(p, words);
        const score = Math.floor((lcs.getLength() * 100) / p.length);
        // const score = Math.floor(Math.random() * 100);
        this.scoreLogger.log('test19', lcs.getLength());
        this.scoreLogger.log('score', score);
        this.scoreLogger.log('seq', lcs.getSequences());

        const oldUserScore = await this.scoreRepository.findOneBy({
          userId: arg[jobIdx].scoreRequestDto.userId,
          audioNumber: arg[jobIdx].oldUserReq.audioNumber,
        });
        let newScore = new Score();
        newScore.audioNumber = arg[jobIdx].oldUserReq.audioNumber;
        newScore.userDisplayName = arg[jobIdx].oldUserReq.userDisplayName;
        newScore.userId = arg[jobIdx].oldUserReq.userId;
        newScore.userScore = score;
        // this.scoreLogger.log('oldUserReq', JSON.stringify(oldUserReq));
        if (oldUserScore !== null) {
          if (score > oldUserScore.userScore) {
            let newScore = new Score();
            newScore.audioNumber = oldUserScore.audioNumber;
            newScore.userDisplayName = oldUserScore.userDisplayName;
            newScore.userId = oldUserScore.userId;
            newScore.userScore = score;
            await this.scoreRepository.update(oldUserScore.id, newScore);
            this.scoreLogger.log('new High score', JSON.stringify(newScore));
          }
          this.scoreLogger.log('new score == old score');
        } else {
          await this.saveScore(arg[jobIdx].scoreRequestDto.userId, score);
          this.scoreLogger.log('new score score', JSON.stringify(newScore));
        }
        await this.s3DeleteObject(`${arg[jobIdx].jobName}.json`);
        const scoreBoard = await this.getScoreBoard(
          arg[jobIdx].oldUserReq.audioNumber,
        );
        await this.util.replyScoreAndScoreBoard({
          ranking: scoreBoard,
          userId: arg[jobIdx].scoreRequestDto.userId,
          replyToken: arg[jobIdx].scoreRequestDto.replyToken,
          score: score.toString(),
          transcription: words,
          audioNumber: arg[jobIdx].oldUserReq.audioNumber,
        });
      }
    }
  }
}
