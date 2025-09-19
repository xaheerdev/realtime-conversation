
import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT || 4001;
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

   sendJSON(upstream, {
  type: "session.update",
  session: {
    voice: "verse",                 // or your env VOICE
    modalities: ["audio", "text"],
    input_audio_format: "pcm16",
    config: {
      turnDetection: {
        type: "semantic_vad",
        eagerness: "medium",
        createResponse: true,       // auto-create responses after user turn ends
        interruptResponse: true     // barge-in: stop TTS immediately on user speech
      }
    },
    input_audio_transcription: {
      model: "whisper-1",
      language: "en",
      prompt: "Transcribe in English only."
    },
    output_audio_format: "pcm16"
  }
});

sendJSON(client, { type: "server.ready" });
    sendJSON(upstream, {
      type: "response.create",
      response: {
        modalities: ["audio", "text"],
        instructions:
          "Greet the user in English  and assit users",
      },
    });
  });

 

  upstream.on("message", (data) => {
   
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


server.listen(PORT, () => {
  console.log(`🚀 HTTP+WS running on http://localhost:${PORT}`);
  console.log(`   WS endpoint: ws://localhost:${PORT}/ws`);
});
