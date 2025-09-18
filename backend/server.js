// server.js
import 'dotenv/config';
import OpenAI from "openai";
const client = new OpenAI();
import WebSocket, { WebSocketServer } from 'ws';



const MODEL = 'gpt-4o-realtime-preview'; // or your realtime model

const wss = new WebSocketServer({ port: 4000, path: '/ws' });

wss.on('connection', (client) => {
  const oa = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${MODEL}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    }
  );

  const safeSend = (ws, obj) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };

  oa.on('open', () => {
    // 1) Configure session: mic transcription + audio out as PCM16 @24k
    safeSend(oa, {
      type: 'session.update',
      session: {
        instructions: [
          "You are a friendly interviewer.",
          "Goal: collect key info by asking short, focused questions.",
          "Rules:",
          " - Ask ONE question at a time.",
          " - Keep each question under 12 words.",
          " - Wait for the user's speech before continuing.",
          " - If silence > 4s, politely reprompt.",
          "IMPORTANT: Always speak ENGLISH only. Never switch languages."
        ].join('\n'),
        voice: 'verse', 
        input_audio_format: 'pcm16',
      input_audio_transcription: {
        model: 'whisper-1',
        language: 'en',                
        prompt: 'Transcribe in English only.'
      },
      output_audio_format: 'pcm16'
    },
    });
//     safeSend(oa, {
//   type: 'session.update',
//   session: {
//     instructions: "… Always speak English only …",
//     voice: 'verse',
//     input_audio_format: 'pcm16',
//     input_audio_transcription: { model: 'whisper-1', language: 'en' },
//     output_audio_format: 'pcm16',
//   },
// });

   
    safeSend(client, { type: 'server.ready' });

    
    safeSend(oa, {
      type: 'response.create',
      response: {
        modalities: ['audio', 'text'],
        instructions: "Greet the user in English and ask your first question now."
      },
    });
  });

  // Browser → OpenAI
  client.on('message', (buf) => {
    try {
      if (oa.readyState === WebSocket.OPEN) oa.send(JSON.stringify(msg));
    } catch {
      console.log("oa not ready")
    }
  });

  // OpenAI → Browser
  oa.on('message', (buf) => {
    // Forward all model events, including response.audio.delta chunks
    if (client.readyState === WebSocket.OPEN) client.send(buf.toString())
  });

  const closeBoth = () => { try { oa.close(); } catch {}; try { client.close(); } catch {
    console.log("closed")
  }; };
  oa.on('close', closeBoth); oa.on('error', closeBoth);
  client.on('close', closeBoth); client.on('error', closeBoth);
});
