
import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT || 4000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REALTIME_MODEL = "gpt-4o-realtime-preview-2024-12-17"; // use your enabled model
const VOICE = process.env.REALTIME_VOICE || "alloy";

if (!OPENAI_API_KEY) {
  console.error("❌ Missing OPENAI_API_KEY in .env");
  process.exit(1);
}

const app = express();
app.use(express.json());

app.get("/healthz", (_, res) =>
  res.json({ ok: true, message: "Server is healthy" })
);

// IMPORTANT: attach WS to the SAME HTTP server (no double binding)
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (client) => {
  console.log("➡️  Browser connected @ /ws");
// client.isAlive = true;
//   client.on("pong", () => { client.isAlive = true; });
  //! Upstream WS to OpenAI Realtime
  const upstream = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`,
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1", // REQUIRED
      },
    }
  );

  // helpers
  const sendRaw = (sock, data) => {
    if (sock.readyState === WebSocket.OPEN) sock.send(data);
  };
  const sendJSON = (sock, obj) => sendRaw(sock, JSON.stringify(obj));

  upstream.on("open", () => {
    console.log("✅ Connected to OpenAI Realtime");

    // Set voice + modalities
    sendJSON(upstream, {
      type: "session.update",
    //  session: {
    //     instructions: [
    //       "You are a friendly interviewer.",
    //       "Goal: collect key info by asking short, focused questions.",
    //       "Rules:",
    //       " - Ask ONE question at a time.",
    //       " - Keep each question under 12 words.",
    //       " - Wait for the user's speech before continuing.",
    //       " - If silence > 4s, politely reprompt.",
    //       "IMPORTANT: Always speak ENGLISH only. Never switch languages."
    //     ].join('\n'),
    //     voice: 'verse', 
    //     input_audio_format: 'pcm16',
    //   input_audio_transcription: {
    //     model: 'whisper-1',
    //     language: 'en',                
    //     prompt: 'Transcribe in English only.'
    //   },
    //   output_audio_format: 'pcm16'
    // },
    session: {
//   instructions: [
//     "ROLE:",
//     "You are a friendly voice concierge. Your job is to understand what the user needs and help them right away.",

//     "",
//     "OPENING:",
//     "• Start with a one-sentence introduction.",
//     "• Ask for the user's name.",
//     "• After the name is CONFIRMED, greet them using it and ask: “How can I assist you today?”",

//     "",
//     "NAME POLICY (STRICT):",
//     "• Never assume, infer, or make up a name.",
//     "• If you think you heard a name, ask to confirm: “Did I get that right — is your name <X>?”",
//     "• Do not use any name until it has been explicitly confirmed.",
//     "• If no name is provided, proceed without using a name.",

//     "",
//     "CORE BEHAVIOR (ASSIST, NOT INTERVIEW):",
//     "• Listen to the user's request and ANSWER it directly, concisely.",
//     "• If you need more details, ask exactly ONE short follow-up question.",
//     "• After answering, offer a brief next step or ask if they need anything else.",
//     "• Prefer practical steps and clear results.",

//     "",
//     "TURN-TAKING:",
//     "• Ask exactly one question at a time.",
//     "• Keep each question under 12 words.",
//     "• Wait for the user's speech before continuing.",

//     "",
//     "SILENCE HANDLING (~4s):",
//     "• If ~4 seconds pass after you finish speaking and no user audio is detected, reprompt politely and do not proceed with other questions until the user responds.",
//     "• If no confirmed name, say: “Are you there? How can I help you today?”",

//     "",
//     "STYLE:",
//     "• Warm, concise, professional. Avoid filler words. Short sentences.",

//     "",
//     "LANGUAGE:",
//     "• Always speak ENGLISH only. Never switch languages."
//   ].join('\\n'),
    instructions: [
      "You are a friendly assistant.Greet the user and offer help.",
      ],

  voice: 'verse',
  modalities: ['audio','text'],
  input_audio_format: 'pcm16',
  input_audio_transcription: {
    model: 'whisper-1',
    language: 'en',
    prompt: 'Transcribe in English only.'
  },
  output_audio_format: 'pcm16'
}


    });

    // Tell browser it can start streaming and/or expect audio
    sendJSON(client, { type: "server.ready" });

    //If you want the agent to immediately greet:
    sendJSON(upstream, {
      type: "response.create",
      response: {
        modalities: ["audio", "text"],
        // instructions:
        //   "Greet the user in English and tell about yourself in one sentence.",
      },
    });
  });

 
// upstream.on("open", () => {
//   console.log("✅ Connected to OpenAI Realtime");

//   // --- System instructions & session config ---
//   sendJSON(upstream, {
//     type: "session.update",
//     session: {
//       // Audio config
//       modalities: ["audio", "text"],
//       voice: "verse",
//       input_audio_format: "pcm16",
//       output_audio_format: "pcm16",

//       // ASR config
//       input_audio_transcription: {
//         model: "whisper-1",
//         language: "en",
//         prompt: "Transcribe in English only."
//       },

//       // Behavior
//       instructions: [
//         "ROLE: You are a friendly voice concierge.",
//         "CONVERSATION PLAN:",
//         "1) Introduce yourself in one short sentence.",
//         "2) Immediately ask for the user's name.",
//         "3) After you learn their name, greet them using the name and ask: 'How can I assist you today?'",
//         "",
//         "TURN-TAKING:",
//         "- Ask exactly one question at a time.",
//         "- Keep each question under 12 words.",
//         "- Wait for the user's speech before continuing.",
//         "",
//         "SILENCE HANDLING:",
//         "- After you finish speaking, if there is ~10 seconds of silence, reprompt politely.",
//         "- If the user's name is known, include it in the reprompt (e.g., 'Saim, are you listening? How can I help you today?').",
//         "- If the name is not yet known, ask generically: 'Are you there? How can I help you today?'",
//         "",
//         "LANGUAGE: Always speak English only. Never switch languages."
//       ].join("\n"),
//     },
//   });

//   // Let the browser know it can start streaming
//   sendJSON(client, { type: "server.ready" });

//   // Start the flow: introduce yourself and ask for the user's name
//   sendJSON(upstream, {
//     type: "response.create",
//     response: {
//       modalities: ["audio", "text"],
//       instructions: "Introduce yourself in one sentence, then ask for the user's name."
//     },
//   });
// });

// FORWARD OpenAI -> Browser (this is what feeds your PCM16 player!)
  upstream.on("message", (data) => {
    // Forward as-is; client expects JSON events incl. response.audio.delta
    sendRaw(
      client,
      typeof data === "string" ? data : data.toString("utf-8")
    );
  });

  upstream.on("close", () => {
    console.log("⛔ Upstream closed");
    try { client.close(); } catch {}
  });

  upstream.on("error", (err) => {
    console.error("⚠️  Upstream error:", err?.message || err);
    try { sendJSON(client, { type: "error", message: "upstream_error" }); } catch {}
    try { client.close(); } catch {}
  });

  // FORWARD Browser -> OpenAI (mic frames, commits, response.create, etc.)
  client.on("message", (data) => {
    sendRaw(
      upstream,
      typeof data === "string" ? data : data.toString("utf-8")
    );
  });

  client.on("close", () => {
    console.log("👋 Browser disconnected");
    try { upstream.close(); } catch {}
  });

  client.on("error", (err) => {
    console.error("⚠️  Browser WS error:", err?.message || err);
    try { upstream.close(); } catch {}
  });
});

// Keepalive (no 'heartbeat' function name — inline only)
// const interval = setInterval(() => {
//   wss.clients.forEach((ws) => {
//     if (ws.isAlive === false) return ws.terminate();
//     ws.isAlive = false;
//     ws.ping(); // 'pong' handler above flips it back to true
//   });
// }, 30000);
// wss.on("close", () => clearInterval(interval));

server.listen(PORT, () => {
  console.log(`🚀 HTTP+WS running on http://localhost:${PORT}`);
  console.log(`   WS endpoint: ws://localhost:${PORT}/ws`);
});
