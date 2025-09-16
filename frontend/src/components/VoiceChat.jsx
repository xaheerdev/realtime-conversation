import { useEffect, useRef, useState } from "react";
import { downsampleTo24kHz, pcm16ToBase64 } from "../lib/audio";

export default function VoiceChat() {
  const wsRef = useRef(null);
  const procRef = useRef(null);
  const srcRef = useRef(null);
  const ctxRef = useRef(null);

  const [connected, setConnected] = useState(false);
  const [recording, setRecording] = useState(false);
  const [partial, setPartial] = useState("");
  const [finals, setFinals] = useState([]);
  // NEW: track server readiness and keep a small send queue
const [serverReady, setServerReady] = useState(false);
const queueRef = useRef([]); // holds JSON strings to send later

function flushQueue() {
  const ws = wsRef.current;
  while (ws && ws.readyState === WebSocket.OPEN && serverReady && queueRef.current.length) {
    ws.send(queueRef.current.shift());
  }
}

// Wrap all sends through this
function wsSend(obj) {
  const ws = wsRef.current;
  const data = JSON.stringify(obj);
  if (!ws || ws.readyState !== WebSocket.OPEN || !serverReady) {
    queueRef.current.push(data);
    return;
  }
  ws.send(data);
}


  console.log("partial",partial)

  // Connect to your relay
const connect = () => {
  if (wsRef.current) return;
  const ws = new WebSocket("ws://localhost:4000/ws");
  wsRef.current = ws;

  ws.onopen = () => setConnected(true);

  ws.onclose = () => { setConnected(false); setServerReady(false); wsRef.current = null; };

  ws.onmessage = (e) => {
    const evt = JSON.parse(e.data);
    console.log("evt", evt);

    if (evt.type === "server.ready") {
      // enable input transcription (ASR) for mic input
      wsSend({
        type: "client.session.update",
        session: { audio: { input: { transcription: { model: "whisper-1" } } } }
      });
      // mark server as ready and flush anything queued (including the session.update above)
      setServerReady(true);
      flushQueue();
    }

    // (optional) confirm the session update took
    if (evt.type === "session.updated") {
      console.log("session updated", evt.session);
    }

    // INPUT (your mic) transcription events:
    if (evt.type === "conversation.item.input_audio_transcription.delta" && evt.delta) {
      setPartial(prev => prev + evt.delta);
    }
    if (evt.type === "conversation.item.input_audio_transcription.completed" && evt.transcript) {
      setFinals(prev => [...prev, evt.transcript]);
      setPartial("");
    }

    // MODEL output text (if you request text)
    if (evt.type === "response.delta" && evt.delta) setPartial(prev => prev + evt.delta);
    if (evt.type === "response.done") {
      if (partial) setFinals(prev => [...prev, partial]);
      setPartial("");
    }
  };
};


  const start = async () => {
    if (!wsRef.current) connect();
    if (recording) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    ctxRef.current = ctx;

    const source = ctx.createMediaStreamSource(stream);
    srcRef.current = source;

    console.log("till now",source);

    // ScriptProcessor is simple and fine for a demo; AudioWorklet is ideal in prod
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    procRef.current = proc;

    const chunkTargetMs = 40; // ~40ms chunks (what the Realtime docs/cookbooks use)
    let acc = new Float32Array();

    proc.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      // accumulate in ~40ms windows (at 48kHz, that's ~1920 samples)
      const needed = Math.round(ctx.sampleRate * (chunkTargetMs / 1000));
      const next = new Float32Array(acc.length + input.length);
      next.set(acc); next.set(input, acc.length);
      acc = next;

      while (acc.length >= needed) {
        const frame = acc.slice(0, needed);
        acc = acc.slice(needed);

        const pcm16 = downsampleTo24kHz(frame, ctx.sampleRate); // → Int16Array @ 24 kHz
        const audioB64 = pcm16ToBase64(pcm16);

        wsRef.current?.send(JSON.stringify({
          type: "client.audio.append",
          audio: audioB64
        }));
      }
    };

    source.connect(proc);
    proc.connect(ctx.destination);
    setRecording(true);
  };

  const stop = async () => {
    if (!recording) return;
    procRef.current?.disconnect(); srcRef.current?.disconnect();
    await ctxRef.current?.close();

    setRecording(false);

    // tell server/OpenAI we’re done with this utterance and want a response
    wsRef.current?.send(JSON.stringify({ type: "client.audio.commit" }));
    wsRef.current?.send(JSON.stringify({ type: "client.response.create" }));
  };

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
    // eslint-disable-next-line
  }, []);

  return (
    <div style={{ maxWidth: 720, margin: "3rem auto", fontFamily: "system-ui" }}>
      <h1>Realtime Voice {connected ? "🟢" : "⚪️"}</h1>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={start} >Start</button>
        <button onClick={stop} >Stop</button>
      </div>

      <h3 style={{ marginTop: 24 }}>Live transcript</h3>
      <div style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8, minHeight: 120 }}>
        {finals.map((t, i) => (
          <div key={i} style={{ marginBottom: 6 }}>{t}</div>
        ))}
        {!!partial && <div style={{ opacity: 0.7 }}>{partial}</div>}
      </div>
    </div>
  );
}



//disabled={!connected || recording}