import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';

const app = express();
app.use(cors());
const server = http.createServer(app);

// Serve a quick health route
app.get('/health', (_, res) => res.json({ ok: true }));
const wss = new WebSocketServer({ server, path: '/ws' });

// Helper to open a WS to OpenAI Realtime
function openRealtimeSocket() {
  const model = process.env.REALTIME_MODEL || 'gpt-realtime'; // current generic name
  const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
  const headers = { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` };
  const upstream = new WebSocket(url, { headers, maxPayload: 1 << 24 });
  return upstream;
}

wss.on('connection', (client) => {
  const upstream = openRealtimeSocket();

  const sendClient = (obj) => client.readyState === 1 && client.send(JSON.stringify(obj));
  const sendUpstream = (obj) => upstream.readyState === 1 && upstream.send(JSON.stringify(obj));

  // When OpenAI socket is ready, inform browser
  upstream.on('open', () => {
    sendClient({ type: 'server.ready' });
  });

  upstream.on('message', (data) => {
    try {
      const evt = JSON.parse(data.toString());
      // pass-through
      sendClient(evt);
    } catch {
      // ignore
    }
  });

  upstream.on('close', () => {
    sendClient({ type: 'server.upstream_closed' });
    client.close();
  });

  upstream.on('error', (err) => {
    sendClient({ type: 'server.upstream_error', error: String(err) });
  });

  client.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      console.log("msg", msg);

      // Audio chunk from browser: base64 PCM16 @ 24k
      if (msg.type === 'client.audio.append' && msg.audio) {
         
        sendUpstream({ type: 'input_audio_buffer.append', audio: msg.audio });
      }

      // Commit the current buffer (end of utterance)
      if (msg.type === 'client.audio.commit') {
        sendUpstream({ type: 'input_audio_buffer.commit' });
      }

      // Ask the model to produce a response (text by default)
      if (msg.type === 'client.response.create') {
        sendUpstream({
          type: 'response.create',
          response: { modalities: ['text'] } // you can include "audio" too
        });
      }

      // Optional: adjust session settings (voice, VAD, etc.)
      if (msg.type === 'client.session.update' && msg.session) {
        sendUpstream({ type: 'session.update', session: msg.session });
      }
    } catch {
      // ignore malformed
    }
  });

  client.on('close', () => {
    console.log("closed by client");
    upstream.close();
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`WS relay on http://localhost:${PORT}/ws`);
});
