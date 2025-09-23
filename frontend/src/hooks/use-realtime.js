
import { useCallback, useEffect, useRef, useState } from "react";
import { downsampleTo24kHz, pcm16ToBase64 } from "../lib/audio";
import { createPCM16Player } from "../audio/pcmPlayer";

const MIC_WORKLET_URL = new URL("../audio/mic-processor.js", import.meta.url);
console.log("MIC_WORKLET_URL", MIC_WORKLET_URL);

//! tune as needed to prevent unbounded memory if server never gets ready
const MAX_QUEUE = 500;

export default function useRealtime() {
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [conversation, setConversation] = useState([]); //! {role, text}[]
  const [serverReady, setServerReady] = useState(false);

  const wsRef = useRef(null);
  const didInitRef = useRef(false);

  //! mic graph
  const ctxRef = useRef(null);
  const workletRef = useRef(null);
  const srcRef = useRef(null);
  const streamRef = useRef(null);

  //! player for model audio (PCM @ 24k)
  const playerRef = useRef(null);
  const ensurePlayer = () => (playerRef.current ??= createPCM16Player());
  const closePlayer = () => {
    try { playerRef.current?.close?.(); } catch {}
    playerRef.current = null;
  };

  //! queue outbound messages until server + upstream are ready
  const queueRef = useRef([]);
  const wsSend = (obj) => {
    const ws = wsRef.current;
    const data = JSON.stringify(obj);
    const isMicAppend = obj?.type === "input_audio_buffer.append";
    const requireReady = !isMicAppend; //! allow streaming frames as soon as WS OPEN

    if (!ws || ws.readyState !== WebSocket.OPEN || (requireReady && !serverReady)) {
      if (queueRef.current.length >= MAX_QUEUE) queueRef.current.shift();
      queueRef.current.push(data);
      return;
    }
    ws.send(data);
  };

  const flushQueue = () => {
    const ws = wsRef.current;
    while (ws && ws.readyState === WebSocket.OPEN && serverReady && queueRef.current.length) {
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
      //! wait for server.ready before sending non-audio msgs
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
      let evt;
      try { evt = JSON.parse(e.data); } catch { return; }

      if (evt.type === "server.ready") {
        setServerReady(true);
        flushQueue();
      }

      if (evt.type === "conversation.item.input_audio_transcription.delta" && evt.delta) {
        //! optional partials
      }

      if (evt.type === "conversation.item.input_audio_transcription.completed" && evt.transcript) {
        setConversation((prev) => [...prev, { role: "user", text: evt.transcript }]);
      }

      if (evt.type === "response.completed" || evt.type === "response.done") {
        //! optional finalize
      }

      //! Model audio stream (PCM16 @24k, base64)
      if (evt.type === "response.audio.delta" && evt.delta) {
        const b = atob(evt.delta);
        const int16 = new Int16Array(b.length / 2);
        for (let i = 0, j = 0; i < b.length; i += 2) {
          int16[j++] = ((b.charCodeAt(i) | (b.charCodeAt(i + 1) << 8)) << 16) >> 16;
        }
        ensurePlayer().appendPCM16(int16);
      }
    };
  }, []);

  //! ---- MIC start/stop identical flow to your VoiceChat.jsx ----
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
      processorOptions: { chunkSize: Math.round(ctx.sampleRate * 0.04) }, //! ~40ms frames
    });
    workletRef.current = node;

    node.port.onmessage = (e) => {
      const float32 = e.data; //! 48 kHz frame from mic
      const pcm16 = downsampleTo24kHz(float32, ctx.sampleRate); //! convert to 24k PCM16
      const audioB64 = pcm16ToBase64(pcm16);
      wsSend({ type: "input_audio_buffer.append", audio: audioB64 });

      //! quick volume estimate
      let sum = 0;
      for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
      const rms = Math.sqrt(sum / float32.length);
      setVolumeLevel(rms);
    };

    source.connect(node);
    setIsSessionActive(true);
  }, [connect, isSessionActive]);

  const stopMic = useCallback(
    async (noCommit = false) => {
      if (!isSessionActive) return;
      try { srcRef.current?.disconnect(); } catch {}
      try { workletRef.current?.disconnect?.(); } catch {}
      try { await ctxRef.current?.close(); } catch {}
      try { streamRef.current?.getTracks?.().forEach((t) => t.stop()); } catch {}
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

  //! ---------- Wake-word listener (Web Speech API) with safe backoff ----------
  const recognitionRef = useRef(null);
  const wakeActiveRef = useRef(false);
  const wakeRestartTimerRef = useRef(null);
  const wakeBackoffMsRef = useRef(500); //! exponential backoff start

  const safeStartRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.start();
      wakeBackoffMsRef.current = 500; //! reset on success
    } catch (e) {
      //! NotAllowedError or "start while active" -> retry with backoff
      clearTimeout(wakeRestartTimerRef.current);
      wakeRestartTimerRef.current = setTimeout(() => {
        safeStartRecognition();
        wakeBackoffMsRef.current = Math.min(wakeBackoffMsRef.current * 2, 8000); // cap 8s
      }, wakeBackoffMsRef.current);
    }
  }, []);

  //! Call this once from a user gesture (button) to enable the passive wake listener
  const enableWakeListener = useCallback(() => {
    if (recognitionRef.current) return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("SpeechRecognition API not available in this browser.");
      return;
    }

    try {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";

      rec.onresult = (event) => {
        const res = event.results[event.results.length - 1];
        const txt = (res?.[0]?.transcript || "").trim().toLowerCase();

        //! wake phrase
        if (!isSessionActive && txt.includes("hey siri")) {
          if (wakeActiveRef.current) return;
          wakeActiveRef.current = true;
          toggleCall();
          setTimeout(() => (wakeActiveRef.current = false), 1500);
        }
      };

      rec.onend = () => {
        //! auto-restart (with backoff) when not in an active session
        if (!isSessionActive) safeStartRecognition();
      };

      recognitionRef.current = rec;
      safeStartRecognition(); //! start once; retries handled internally
    } catch (e) {
      console.warn("SpeechRecognition init failed:", e?.message || e);
    }
  }, [isSessionActive, safeStartRecognition, toggleCall]);

  //! pause wake listener during active session; resume after
  useEffect(() => {
    const rec = recognitionRef.current;
    if (!rec) return;

    if (isSessionActive) {
      try { rec.stop(); } catch {}
    } else {
      clearTimeout(wakeRestartTimerRef.current);
      wakeRestartTimerRef.current = setTimeout(() => safeStartRecognition(), 300);
    }
    return () => clearTimeout(wakeRestartTimerRef.current);
  }, [isSessionActive, safeStartRecognition]);

  //! ---------- Power/battery: suspend audio context when tab hidden ----------
  useEffect(() => {
    const onVis = async () => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      if (document.hidden) {
        try { await ctx.suspend(); } catch {}
      } else {
        try { await ctx.resume(); } catch {}
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  //! ---------- Cleanup ----------
  useEffect(() => {
    return () => {
      try { wsRef.current?.close?.(); } catch {}
      closePlayer();
      try { recognitionRef.current?.stop?.(); } catch {}
      recognitionRef.current = null;
      clearTimeout(wakeRestartTimerRef.current);
    };
  }, []);

  return {
    volumeLevel,
    isSessionActive,
    conversation,
    toggleCall,
    enableWakeListener,
  };
}
