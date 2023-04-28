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
import { StartTranscriptionJobCommand } from '@aws-sdk/client-transcribe';
import { S3Client } from '@aws-sdk/client-s3';
import { PutObjectCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { Client } from '@line/bot-sdk';

const speech = require('@google-cloud/speech');
const line = require('@line/bot-sdk');
const fs = require('fs');
const path = require('path');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);
const { TranscribeClient } = require('@aws-sdk/client-transcribe');
require('dotenv').config();
const REGION = 'us-east-2';

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
    this.scoreLogger.log('getScore: start');
    this.scoreLogger.log('messageId', scoreRequestDto.messageId);
    this.scoreLogger.log('userId', scoreRequestDto.userId);
    const lineClient = new Client({
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
      channelSecret: process.env.LINE_CHANNEL_SECRET,
    });
    let audioBytes;

    const fileName = 'audio';
    lineClient
      .getMessageContent(scoreRequestDto.messageId)
      .then((stream) => {
        stream.on('data', (chunk) => {
          // this.scoreLogger.log('chunk: ', chunk);
          // audioBytes = chunk.toString('base64');
          // this.scoreLogger.log('audioBytes: ', audioBytes);
          // const buffer = Buffer.from(audioBytes, 'base64');
          fs.writeFileSync(`${fileName}.m4a`, chunk);
          fs.writeFileSync(`${fileName}.wav`, '');

          // this.scoreLogger.log(
          //   `wrote ${buffer.byteLength.toLocaleString()} bytes to file.`,
          // );

          const s3Put = async () => {
            const fileContent = fs.readFileSync(`${fileName}.wav`);
            const s3Client = new S3Client({ region: REGION });
            const s3Params = {
              Bucket: 'line-data-cloud', // The name of the bucket. For example, 'sample-bucket-101'.
              Key: `${fileName}.wav`, // The name of the object. For example, 'sample_upload.txt'.
              Body: fileContent, // The content of the object. For example, 'Hello world!".
            };
            try {
              const results = await s3Client.send(
                new PutObjectCommand(s3Params),
              );
              this.scoreLogger.log(
                'Successfully created ' +
                  s3Params.Key +
                  ' and uploaded it to ' +
                  s3Params.Bucket +
                  '/' +
                  s3Params.Key,
              );
              this.scoreLogger.log('S3put', results);
              transcribe();
              // return results; // For unit tests.
            } catch (err) {
              this.scoreLogger.log('Error', err);
            }
            // fs.unlinkSync(`${fileName}.m4a`);
            // fs.unlinkSync(`${fileName}.wav`);
          };

          const transcribe = async () => {
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
              const data = await transcribeClient.send(
                new StartTranscriptionJobCommand(params),
              );
              this.scoreLogger.log('Success - put', data);
              return { score: data }; // For unit tests.
            } catch (err) {
              this.scoreLogger.log('Error', err);
            }
          };

          const convert = async () => {
            await this.convertFileFormat(
              `${fileName}.m4a`,
              `${fileName}.wav`,
              function (errorMessage) {},
              null,
              function () {
                // this.scoreLogger.log('convert');
                // s3Put();
              },
            ).then((res) => {
              this.scoreLogger.log('res done');
              if (res === 'done!') {
                let size = fs.statSync(`${fileName}.wav`).size;
                while (size === 0) {
                  size = fs.statSync(`${fileName}.wav`).size;
                }
                s3Put();
              }
            });
          };
          convert();
        });
        stream.on('error', (err) => {
          // error handling
          this.scoreLogger.log('err: ', err);
          console.log(err);
        });
      })
      .catch((err) => {
        this.scoreLogger.log('err2: ', err);
      });

    return { score: '0' };
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

  convertFileFormat(
    file,
    destination,
    error,
    progressing,
    finish,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const inStream = fs.createReadStream(file);
      const outStream = fs.createWriteStream(destination);
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
        })
        .on('end', () => {
          this.scoreLogger.log('converting format finished !');
        })
        .writeToStream(outStream, { end: true });
      // finish();
      return resolve('done!');
    });
  }

  getFilesizeInBytes(filename) {
    var stats = fs.statSync(filename);
    var fileSizeInBytes = stats.size;
    return fileSizeInBytes;
  }
}
