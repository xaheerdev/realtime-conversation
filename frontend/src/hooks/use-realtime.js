// src/hooks/use-realtime.js
import { useCallback, useEffect, useRef, useState } from "react";
import { downsampleTo24kHz, pcm16ToBase64 } from "../lib/audio";
import { createPCM16Player } from "../audio/pcmPlayer";

const MIC_WORKLET_URL = new URL("../audio/mic-processor.js", import.meta.url);
console.log("MIC_WORKLET_URL", MIC_WORKLET_URL);

export default function useRealtime() {
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [conversation, setConversation] = useState([]); // {role, text}[]
  const wsRef = useRef(null);
  const didInitRef = useRef(false);

  // mic graph
  const ctxRef = useRef(null);
  const workletRef = useRef(null);
  const srcRef = useRef(null);
  const streamRef = useRef(null);
  const mediaRecRef = useRef(null);

  // player for model audio (PCM @ 24k)
  const playerRef = useRef(null);
  const ensurePlayer = () => (playerRef.current ??= createPCM16Player());
  const closePlayer = () => {
    playerRef.current?.close();
    playerRef.current = null;
  };

  // queue outbound messages until server + upstream are ready
  const [serverReady, setServerReady] = useState(false);
  const queueRef = useRef([]);
  const wsSend = (obj) => {
   const ws = wsRef.current;
    const data = JSON.stringify(obj);
  if (!ws || ws.readyState !== WebSocket.OPEN || !serverReady) {
  const isMicAppend = obj?.type === "input_audio_buffer.append";
   const requireReady = !isMicAppend; // allow streaming as soon as ws is OPEN
   if (!ws || ws.readyState !== WebSocket.OPEN || (requireReady && !serverReady)) {
      queueRef.current.push(data);
      return;
    }
    ws.send(data);
  }};
  const flushQueue = () => {
     const ws = wsRef.current;
    while (
      ws &&
      ws.readyState === WebSocket.OPEN &&
      serverReady &&
      queueRef.current.length
    ) {
      ws.send(queueRef.current.shift());
    }
  };

  const connect = useCallback(() => {
    if (wsRef.current) return;

    if (didInitRef.current) return;
    didInitRef.current = true;
    const ws = new WebSocket("ws://localhost:4000/ws");
    wsRef.current = ws;
    ws.onopen = () => {
      console.log("[WS] connected");
      wsRef.current = ws;
      // now we are at least TCP/WS-level connected to our Node relay — wait for server.ready before sending audio
      // now we are at least TCP/WS-level
      // connected to our Node relay — wait for server.ready before sending audio
    };

    ws.onclose = () => {
      wsRef.current = null;
      setIsSessionActive(false);
      setServerReady(false);
      closePlayer();
    };

    ws.onerror = (e) => {
      console.error("[WS error]", e);
    };

    ws.onmessage = (e) => {
      const evt = JSON.parse(e.data);
      console.log("EVENT", evt);

      if (evt.type === "server.ready") {
        console.log("Server is ready");
        setServerReady(true);
        flushQueue();
        
      }
      if (
        evt.type === "conversation.item.input_audio_transcription.delta" &&
        evt.delta
      ) {
        console.log("TRANSCRIPT DELTA", evt.delta);
      }
      if (
        evt.type === "conversation.item.input_audio_transcription.completed" &&
        evt.transcript
      ) {
        setConversation((prev) => [
          ...prev,
          { role: "user", text: evt.transcript },
        ]);
      }

      // Model text tokens
      if (evt.type === "response.delta" && evt.delta) {
        // accumulate partials if you want
      }
      if (evt.type === "response.output_text.delta" && evt.delta) {
        // new event name in some previews; handle both
      }
      if (evt.type === "response.completed" || evt.type === "response.done") {
        // If you tracked partials, push final here
      }

      // Model audio stream (PCM16 @24k, base64)
      if (evt.type === "response.audio.delta" && evt.delta) {
        const b = atob(evt.delta);
        const int16 = new Int16Array(b.length / 2);
        for (let i = 0, j = 0; i < b.length; i += 2) {
          int16[j++] =
            ((b.charCodeAt(i) | (b.charCodeAt(i + 1) << 8)) << 16) >> 16;
        }
        ensurePlayer().appendPCM16(int16);
      }
    };
  }, []);

  // ---- MIC start/stop identical flow to your VoiceChat.jsx ----
  const startMic = useCallback(async () => {
    connect();
    if (isSessionActive) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    streamRef.current = stream;

    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ sampleRate: 48000 });
    ctxRef.current = ctx;

    await ctx.audioWorklet.addModule(MIC_WORKLET_URL);
    const source = ctx.createMediaStreamSource(stream);
    srcRef.current = source;

    const node = new AudioWorkletNode(ctx, "mic-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: { chunkSize: Math.round(ctx.sampleRate * 0.04) }, // ~40ms frames
    });
    workletRef.current = node;

    node.port.onmessage = (e) => {
      const float32 = e.data; // 48 kHz frame from mic
      const pcm16 = downsampleTo24kHz(float32, ctx.sampleRate); // convert to 24k PCM16
      const audioB64 = pcm16ToBase64(pcm16);
      wsSend({ type: "input_audio_buffer.append", audio: audioB64 });
      // quick volume estimate
      let sum = 0;
      for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
      const rms = Math.sqrt(sum / float32.length);
      setVolumeLevel(rms);
    };

    source.connect(node);
    setIsSessionActive(true);
  }, [connect, isSessionActive,MIC_WORKLET_URL]);

  const stopMic = useCallback(
    async (noCommit = false) => {
      if (!isSessionActive) return;
      try {
        srcRef.current?.disconnect();
        workletRef.current?.disconnect?.();
      } catch {}
      try {
        await ctxRef.current?.close();
      } catch {}
      try {
        streamRef.current?.getTracks?.().forEach((t) => t.stop());
      } catch {}
      setIsSessionActive(false);

      if (!noCommit) {
        wsSend({ type: "input_audio_buffer.commit" });
        wsSend({ type: "response.create" });
      }
    },
    [isSessionActive]
  );

  const toggleCall = useCallback(async () => {
    if (isSessionActive) {
      await stopMic(false);
    } else {
      await startMic();
    }
  }, [isSessionActive, startMic, stopMic]);

  useEffect(() => {
    return () => {
      try {
        wsRef.current?.close();
      } catch {}
      closePlayer();
    };
  }, []);

  return { volumeLevel, isSessionActive, conversation, toggleCall };
}
