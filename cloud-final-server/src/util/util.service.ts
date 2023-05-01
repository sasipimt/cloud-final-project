import { Injectable } from '@nestjs/common';
import { Score } from 'src/schema/score.entity';
const request = require('request-promise');
const LINE_MESSAGING_API = 'https://api.line.me/v2/bot/message';
const LINE_HEADER = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
};
interface Props {
  ranking: Array<Score>;
  userId: string;
  replyToken: string;
  audioNumber: string;
  score: string;
  transcription: string;
}

@Injectable()
export class UtilService {
  async replyScoreAndScoreBoard(body: Props) {
    let ranking = [];
    body.ranking.map((user, idx) => {
      ranking.push({
        type: 'box',
        layout: 'vertical',
        margin: 'lg',
        spacing: 'sm',
        contents: [
          {
            type: 'box',
            layout: 'baseline',
            spacing: 'sm',
            contents: [
              {
                type: 'text',
                text: `${idx + 1}`,
                color: '#aaaaaa',
                size: 'sm',
                flex: 1,
              },
              {
                type: 'text',
                text: `${user.userDisplayName ?? '-'}`,
                wrap: true,
                color: '#666666',
                size: 'sm',
                flex: 5,
              },
              {
                type: 'text',
                text: `${user.userScore ?? '-'}`,
              },
            ],
          },
        ],
      });
    });
    const scoreboard_json = this.scoreBoardJson({
      ranking: ranking,
      audioNumber: body.audioNumber,
    });

    request({
      method: `POST`,
      uri: `${LINE_MESSAGING_API}/reply`,
      headers: LINE_HEADER,
      body: JSON.stringify({
        replyToken: body.replyToken,
        messages: [
          this.yourResult(body.score, body.transcription),
          scoreboard_json,
        ],
      }),
    });
  }
  scoreBoardJson(body) {
    const contents_list = [
      {
        type: 'text',
        text: 'Score Board',
        weight: 'bold',
        size: 'xl',
      },
      {
        type: 'box',
        layout: 'baseline',
        contents: [
          {
            type: 'text',
            text: `Audio Number ${body.audioNumber}`,
            size: 'sm',
            color: '#999999',
            flex: 0,
          },
        ],
      },
    ];
    body.ranking.map((user) => {
      contents_list.push(user);
    });
    return {
      type: 'flex',
      altText: 'This is score board',
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [...contents_list],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'button',
              action: {
                type: 'message',
                label: 'Play',
                text: `a ${body.audioNumber}`,
              },
              style: 'primary',
              height: 'md',
            },
            {
              type: 'button',
              action: {
                type: 'message',
                label: 'View Score Board',
                text: `s ${body.audioNumber}`,
              },
            },
          ],
        },
      },
    };
  }
  yourResult(score, transcription) {
    return {
      type: 'flex',
      altText: 'This is your result',
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: 'คะแนน',
              weight: 'bold',
              color: '#1DB446',
              size: 'sm',
            },
            {
              type: 'text',
              text: `${score}/100`,
              weight: 'regular',
              size: 'xxl',
              margin: 'md',
            },
            {
              type: 'separator',
              margin: 'md',
            },
            {
              type: 'text',
              text: 'ฉันได้ยินคุณพูดว่า',
              weight: 'bold',
              color: '#1DB446',
              size: 'sm',
              margin: 'xl',
            },
            {
              type: 'text',
              text: `" ${transcription} "`,
              weight: 'regular',
              size: 'lg',
              margin: 'md',
            },
          ],
        },
        styles: {
          footer: {
            separator: true,
          },
        },
      },
    };
  }
}
