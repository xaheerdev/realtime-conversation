// src/components/VoiceChat.jsx
import { useEffect, useRef, useState } from "react";
import { downsampleTo24kHz, pcm16ToBase64 } from "../lib/audio";
import { createPCM16Player } from "../audio/pcmPlayer";


const MIC_WORKLET_URL = new URL("../audio/mic-processor.js", import.meta.url);

export default function VoiceChat() {
  const wsRef = useRef(null);

  // capture graph
  const workletRef = useRef(null);
  const srcRef = useRef(null);
  const ctxRef = useRef(null);
  const streamRef = useRef(null);

  // local record UI (unchanged)
  const mediaRecRef = useRef(null);
  const recChunksRef = useRef([]);
  const [audioUrl, setAudioUrl] = useState(null);

  // state
  const [connected, setConnected] = useState(false);
  const [recording, setRecording] = useState(false);
  const [partial, setPartial] = useState("");
  const [finals, setFinals] = useState([]);
  console.log("finals", finals);
  console.log("partial", partial);

  // queue until model session is ready
  const [serverReady, setServerReady] = useState(false);
  const queueRef = useRef([]);
  const wsSend = (obj) => {
    const ws = wsRef.current; const data = JSON.stringify(obj);
    if (!ws || ws.readyState !== WebSocket.OPEN || !serverReady) { queueRef.current.push(data); return; }
    ws.send(data);
  };
  const flushQueue = () => {
    const ws = wsRef.current;
    while (ws && ws.readyState === WebSocket.OPEN && serverReady && queueRef.current.length) {
      ws.send(queueRef.current.shift());
    }
  };

  // MODEL AUDIO PLAYER
  const playerRef = useRef(null);
  const ensurePlayer = () => (playerRef.current ??= createPCM16Player());
  const closePlayer = () => { playerRef.current?.close(); playerRef.current = null; };

  // ---------- WEBSOCKET CONNECT ----------
  const connect = () => {
    if (wsRef.current) return;
    const ws = new WebSocket("ws://localhost:4000/ws");
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    //ws.onopen = () => {setConnected(true);console.log("ws opened")};
    ws.onclose = () => { setConnected(false); setServerReady(false); wsRef.current = null; closePlayer(); };
    

    ws.onmessage = async(e) => {
      const evt = JSON.parse(e.data);
      console.log("evt", evt);
      if (evt.type === 'server.ready') {
  setServerReady(true);
  flushQueue();
  // kick the agent if it hasn't spoken yet
  wsSend({
    type: 'response.create',
    response: { modalities: ['audio','text'], instructions: 'Please greet me and ask the first question.' }
  });
}

      // Input transcription from our mic
      if (evt.type === "conversation.item.input_audio_transcription.delta" && evt.delta) {
        setPartial(prev => prev + evt.delta);
      }
      if (evt.type === "conversation.item.input_audio_transcription.completed" && evt.transcript) {
        setFinals(prev => [...prev, evt.transcript]); setPartial("");
      }

      // Model text stream (optional)
      if (evt.type === "response.delta" && evt.delta) setPartial(p => p + evt.delta);
      if (evt.type === "response.done") {
        if (partial) setFinals(prev => [...prev, partial]);
        setPartial("");

        // Model finished speaking → start listening automatically
        startMic(); // auto turn-taking
      }

      // ---- Model audio stream (PCM16 @24k) ----
      if (evt.type === "response.audio.delta" && evt.delta) {
        // When audio arrives, ensure we STOP mic so we don't capture playback
       // if (recording) stopMic(true);
        if (recording) {
    wsSend({ type: 'input_audio_buffer.commit' });  // <--
    wsSend({ type: 'response.create' });            // <--
    await stopMic(/* noCommit */ true);             // stop without sending another commit
  }
        const bytes = atob(evt.delta);
        const int16 = new Int16Array(bytes.length / 2);
        for (let i = 0, j = 0; i < bytes.length; i += 2) {
          int16[j++] = (bytes.charCodeAt(i) | (bytes.charCodeAt(i + 1) << 8)) << 16 >> 16;
        }
        ensurePlayer().appendPCM16(int16);
      }
    };
  };

  // ---------- MIC: START / STOP ----------
  const startMic = async () => {
    if (!wsRef.current) connect();
    if (recording) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });
    streamRef.current = stream;

    const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    ctxRef.current = ctx;

    await ctx.audioWorklet.addModule(MIC_WORKLET_URL);
    const source = ctx.createMediaStreamSource(stream);
    srcRef.current = source;

    const node = new AudioWorkletNode(ctx, 'mic-capture', {
      numberOfInputs: 1, numberOfOutputs: 0,
      processorOptions: { chunkSize: Math.round(ctx.sampleRate * 0.04) }
    });
    workletRef.current = node;

    node.port.onmessage = (e) => {
      const float32 = e.data; // 48kHz frame
      const pcm16 = downsampleTo24kHz(float32, ctx.sampleRate);
      const audioB64 = pcm16ToBase64(pcm16);
      wsSend({ type: 'input_audio_buffer.append', audio: audioB64 });
    };

    source.connect(node);

    // (Optional) local recorder just for "Last recording" UI
    if ("MediaRecorder" in window) {
      const mime =
        MediaRecorder.isTypeSupported?.("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" :
        MediaRecorder.isTypeSupported?.("audio/webm") ? "audio/webm" : "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecRef.current = mr; recChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data?.size) recChunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(recChunksRef.current, { type: mr.mimeType || "audio/webm" });
        const url = URL.createObjectURL(blob);
        setAudioUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
      };
      mr.start();
    }

    setRecording(true);
  };

  const stopMic = async (noCommit = false) => {
    if (!recording) return;
    try { srcRef.current?.disconnect(); workletRef.current?.disconnect?.(); } catch {}
    try { await ctxRef.current?.close(); } catch {}
    try {
      if (mediaRecRef.current && mediaRecRef.current.state !== "inactive") mediaRecRef.current.stop();
      streamRef.current?.getTracks?.().forEach(t => t.stop());
    } catch {}

    setRecording(false);

    // Commit the utterance and ask the model to respond
    if (!noCommit) {
      wsSend({ type: 'input_audio_buffer.commit' });
      wsSend({ type: 'response.create' });
    }
  };

  // ---------- LIFECYCLE ----------
  useEffect(() => {
    connect();
    return () => { try { wsRef.current?.close(); } catch {}; if (audioUrl) URL.revokeObjectURL(audioUrl); closePlayer(); };
  }, []);

  return (
    <div style={{ maxWidth: 720, margin: "3rem auto", fontFamily: "system-ui" }}>
      <h1>Voice Interview {connected ? "🟢" : "⚪️"}</h1>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={startMic} >Start speaking</button>
        <button onClick={() => stopMic(false)} >Stop speaking</button>
      </div>

      <h3 style={{ marginTop: 24 }}>Transcript</h3>
      <div style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8, minHeight: 120 }}>
        {finals.map((t, i) => (<div key={i} style={{ marginBottom: 6 }}>{t}</div>))}
        {!!partial && <div style={{ opacity: 0.7 }}>{partial}</div>}
      </div>

      {audioUrl && (
        <>
          <h3 style={{ marginTop: 24 }}>Last recording</h3>
          <audio controls src={audioUrl} style={{ width: "100%" }} />
          <div style={{ marginTop: 8 }}><a href={audioUrl} download="mic-recording.webm">Download</a></div>
        </>
      )}
    </div>
  );
}
