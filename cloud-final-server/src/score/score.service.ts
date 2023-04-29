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
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Client } from '@line/bot-sdk';

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
const fileType = '.m4a';
const request = require('request');

@Injectable()
export class ScoreService {
  constructor(
    @InjectRepository(RequestHistory)
    private readonly requestHistoryRepository: Repository<RequestHistory>,
    @InjectRepository(Score)
    private readonly scoreRepository: Repository<Score>,
    @InjectRepository(ScoreBoard)
    private readonly scoreBoardRepository: Repository<ScoreBoard>,
  ) // private readonly httpService: HttpService,
  {}
  private readonly scoreLogger = new Logger('ScoreService');
  async getUserDisplayName(userId: string): Promise<string> {
    // const res = await firstValueFrom(
    //   this.httpService.get(`https://api.line.me/v2/bot/profile/${userId}`, {
    //     headers: {
    //       'Content-Type': 'application/json',
    //       Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    //     },
    //   }),
    // );
    const options = {
      method: 'GET',
      url: `https://api.line.me/v2/bot/profile/${userId}`,
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    };
    await request(options, function (error, response) {
      if (error) throw new Error(error);
      console.log(response.body);
      this.scoreLogger.log('request', response.body);
      return response.body.displayName;
    });
    // if (res.data.hasOwnProperty('displayName')) {
    //   return res.data['displayName'];
    // }
    return 'err';
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
      const displayName = await this.getUserDisplayName(audioRequestDto.userId);
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
    this.scoreLogger.log('getScore: start');
    this.scoreLogger.log('messageId', scoreRequestDto.messageId);
    this.scoreLogger.log('userId', scoreRequestDto.userId);
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
    await stream.on('data', (chunk) => {
      fs.writeFileSync(`${fileName}${fileType}`, chunk);
      this.scoreLogger.log('chunk: ', chunk);
      this.scoreLogger.log('test2');
    });

    await stream.on('error', (err) => {
      this.scoreLogger.log('test3');
    });
    await stream.on('end', async () => {
      this.scoreLogger.log('There will be no more data.');
      fs.writeFileSync(`${fileName}.wav`, 'a');
      this.scoreLogger.log('test3.5');
    });
    this.scoreLogger.log('test4');
    await this.convertFileFormat(
      `${fileName}`,
      `${fileName}.wav`,
      function (errorMessage) {},
      null,
      function () {},
    );

    this.scoreLogger.log('test9');
    const name = await this.s3Put(`${fileName}`);
    this.scoreLogger.log('test14');
    const jobName = await this.transcribe(scoreRequestDto, name);
    this.scoreLogger.log('test18');
    let transcriptionStatus = await this.getTranscriptionStatus(jobName);
    while (transcriptionStatus !== 'COMPLETED') {
      transcriptionStatus = await this.getTranscriptionStatus(jobName);
      if (transcriptionStatus === 'FAILED') {
        return { score: 0, transcription: 'TRANSCRIPTION FAILED' };
      }
    }
    const transcription = await this.s3GetObject(`${jobName}.json`);
    const transcriptionJSON = JSON.parse(transcription);
    let transcriptionWords = [];
    for (let item of transcriptionJSON.results.items) {
      if (item.type === 'pronunciation') {
        transcriptionWords.push(item.alternatives[0].content);
      }
    }
    const score = Math.random();
    await this.saveScore(scoreRequestDto.userId, score);
    return {
      score: score,
      transcription: transcriptionWords.toString(),
    };
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

  convertFileFormat(
    file: string,
    destination,
    error,
    progressing,
    finish,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      this.scoreLogger.log('test5');
      const inStream = fs.createReadStream(`${file}${fileType}`);
      const outStream = fs.createWriteStream(destination);
      ffmpeg.ffprobe(inStream, (err, meta) => {
        this.scoreLogger.log(meta);
      });
      const x = new ffmpeg({ source: inStream })
        .toFormat('wav')
        .on('error', (err) => {
          this.scoreLogger.log('An error occurred: ' + err.message);
          return reject(new Error(err));
        })
        .on('progress', (progress) => {
          // console.log(JSON.stringify(progress));
          this.scoreLogger.log(
            'Processing: ' + progress.targetSize + ' KB converted',
          );
          this.scoreLogger.log('test6');
        })
        .on('end', () => {
          this.scoreLogger.log('converting format finished !');
          this.scoreLogger.log('test7');
          return resolve(x);
        })
        .writeToStream(outStream, { end: true });
      // finish();
      this.scoreLogger.log('test8');
      this.scoreLogger.log('ffmpeg: ', x.toString());
    });
  }

  getFilesizeInBytes(filename) {
    var stats = fs.stat(filename);
    var fileSizeInBytes = stats.size;
    return fileSizeInBytes;
  }

  async s3Put(fileName: string) {
    this.scoreLogger.log('test10');
    const fileContent = fs.readFileSync(`${fileName}.wav`);
    const s3Params = {
      Bucket: 'line-data-cloud', // The name of the bucket. For example, 'sample-bucket-101'.
      Key: `${fileName}.wav`, // The name of the object. For example, 'sample_upload.txt'.
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
    // fs.unlinkSync(`${fileName}.m4a`);
    // fs.unlinkSync(`${fileName}.wav`);
  }

  async transcribe(
    scoreRequestDto: ScoreRequestDto,
    fileName: string,
  ): Promise<string> {
    this.scoreLogger.log('test15');
    const params = {
      TranscriptionJobName: `TRANSCIBE_${scoreRequestDto.messageId}`,
      LanguageCode: 'th-TH', // For example, 'en-US'
      MediaFormat: 'wav', // For example, 'wav'
      Media: {
        MediaFileUri: `https://line-data-cloud.s3.us-east-2.amazonaws.com/${fileName}.wav`,
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
}
