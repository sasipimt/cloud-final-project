import { Injectable, Logger } from '@nestjs/common';
import { Score } from 'src/schema/score.entity';
const request = require('request-promise');
require('dotenv').config();
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
  private readonly utilLogger = new Logger('UtilService');
  async replyScoreAndScoreBoard(body: Props) {
    this.utilLogger.log('start reply', JSON.stringify(body));
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

  async replyProgress(body) {
    const content = {
      type: 'flex',
      altText: 'This is your progress',
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: 'สถานะ',
              weight: 'bold',
              color: '#1DB446',
              size: 'sm',
            },
            {
              type: 'text',
              text: 'IN PROGRESS',
              weight: 'bold',
              size: 'xl',
            },
            {
              type: 'text',
              text: `#${body.jobName}`,
              color: '#aaaaaa',
            },
            {
              type: 'text',
              text: 'กรุณารอสักครู่ ระบบกำลังฟังที่ท่านพูดมาล่าสุดและคิดคะแนน',
              wrap: true,
              margin: 'lg',
            },
            {
              type: 'text',
              text: 'กดปุ่มด้านล่างเพื่อดูสถานะ',
              margin: 'lg',
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'button',
              style: 'secondary',
              height: 'sm',
              action: {
                type: 'message',
                label: 'CHECK',
                text: `c ${body.jobName}`,
              },
            },
          ],
          flex: 0,
        },
      },
    };
    return request({
      method: `POST`,
      uri: `${LINE_MESSAGING_API}/reply`,
      headers: LINE_HEADER,
      body: JSON.stringify({
        replyToken: body.replyToken,
        messages: [content],
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
              wrap: true,
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

  getSentences(audioNumber: number) {
    const sentences = [
      'กินมันติดเหงือกกินเผือกติดฟันกินทั้งมันกินทั้งเผือกติดทั้งเหงือกติดทั้งฟัน',
      'ลองมาแวะชิมเฉาก๊วยแท้แท้กันก่อนนะครับเฉาก๊วยชากังราวของเรานะครับ',
      'ดูหนูสู่รูงูงูสุดสู้หนูสู้งูหนูงูสู้ดูอยู่รูปงูทู่หนูมูทู',
      'เธออย่าพูดอะไรเลยเพราะภาษาเป็นที่มาของความเข้าใจผิด',
      'เมื่อมั่งมีมากมายมิตรหมายมองเมื่อมัวหมองมิตรมองหม่นเหมือนหมูหมา',
      'ผู้ใหญ่ทุกคนเคยเป็นเด็กมาก่อนแล้วทั้งนั้นแต่น้อยคนนักที่จะหวนระลึกได้',
      'วันนั้นจันทรมีดารากรเป็นบริวารเห็นสิ้นดินฟ้าในป่าท่าธารมาลีคลี่บานใบก้านอรชร',
      'ฉันควรรู้จักตัดสินเธอจากการกระทำของเธอมิใช่จากคำพูดของเธอ',
      'หัวลิงหมากลางลิงต้นลางลิงแลหูลิงลิงไต่กระไดลิงลิงโลดคว้าประสาลิง',
      'อย่าสงสารคนตายเลยแฮรี่สงสารคนเป็นเถอะโดยเฉพาะคนที่อยู่โดยปราศจากรัก',
    ];
    return sentences[audioNumber - 1];
  }
}
