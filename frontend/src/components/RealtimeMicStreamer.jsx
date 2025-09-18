// import { useEffect, useMemo, useRef, useState } from 'react';

// /**
//  * RealtimeMicStreamer.jsx (React + JS + Tailwind)
//  *
//  * Streams microphone audio to your websocket server in near‑real‑time as the user speaks.
//  * - Captures mic with Web Audio
//  * - Resamples to 24kHz PCM16 (little‑endian)
//  * - Simple VAD (voice activity detection) so we only send when speaking
//  * - Sends OpenAI Realtime events:
//  *     { type: 'input_audio_buffer.append', audio: <base64 pcm16> }
//  *     { type: 'input_audio_buffer.commit' }
//  *     { type: 'response.create', response: { instructions: 'transcribe/respond' } }
//  *
//  * UI
//  * - Big mic button (start/stop)
//  * - Connection + VAD state
//  * - Tiny VU meter
//  *
//  * Notes
//  * - Works best when your page is served over HTTPS (getUserMedia requirement) and connects to wss://
//  * - The server from your snippet forwards our JSON events to the OpenAI Realtime WS.
//  */

// export default function RealtimeMicStreamer() {
//   const [connected, setConnected] = useState(false);
//   const [recording, setRecording] = useState(false);
//   const [speaking, setSpeaking] = useState(false);
//   const [level, setLevel] = useState(0);
//   const [log, setLog] = useState([]);

//   const wsRef = useRef(null);
//   const audioCtxRef = useRef(null);
//   const sourceRef = useRef(null);
//   const processorRef = useRef(null);
//   const streamRef = useRef(null);

//   // Resampler state (Float32 accumulator at 24kHz)
//   const resampleBufRef = useRef(new Float32Array(0));
//   const targetRate = 24000; // match your session.input_audio_format='pcm16' expectations

//   // VAD state
//   const vadTalkingRef = useRef(false);
//   const vadSilenceFramesRef = useRef(0);
//   const vadMinSpeechFrames = 2; // require N frames over threshold to flip to speech
//   const vadSilenceFramesToCommit = 8; // frames of silence before commit (~8 * frameDuration)

//   const WS_URL = useMemo(() => {
//     const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
//     const host = window.location.hostname || 'localhost';
//     return `${proto}://${host}:4000/ws`;
//   }, []);

//   useEffect(() => {
//     const ws = new WebSocket(WS_URL);
//     wsRef.current = ws;

//     ws.addEventListener('open', () => {
//       setConnected(true);
//       pushLog('Connected to proxy WS');
//     });

//     ws.addEventListener('close', () => {
//       setConnected(false);
//       pushLog('Disconnected');
//       stopRecording();
//     });

//     ws.addEventListener('error', (e) => {
//       pushLog('WebSocket error');
//       console.error(e);
//     });

//     // Optional: incoming messages from model / server
//     ws.addEventListener('message', (event) => {
//       // Many events will be JSON strings (including response.audio.delta etc.)
//       // Keep a short rolling log for debugging
//       try {
//         const data = JSON.parse(event.data);
//         if (data.type === 'server.ready') pushLog('Server ready');
//         if (data.type?.startsWith('response.')) {
//           pushLog(`Model event: ${data.type}`);
//         }
//       } catch {
//         // Not JSON, or too large. Ignore for UI.
//       }
//     });

//     return () => {
//       try { ws.close(); } catch {}
//       wsRef.current = null;
//     };
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [WS_URL]);

//   function pushLog(msg) {
//     setLog((l) => [msg, ...l].slice(0, 8));
//   }

//   async function startRecording() {
//     if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
//       pushLog('WS not connected');
//       return;
//     }

//     try {
//       const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true }, video: false });
//       streamRef.current = stream;

//       const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
//       audioCtxRef.current = ctx;

//       const source = ctx.createMediaStreamSource(stream);
//       sourceRef.current = source;

//       const processor = ctx.createScriptProcessor(2048, 1, 1); // ~42.6ms at 48k
//       processorRef.current = processor;

//       source.connect(processor);
//       processor.connect(ctx.destination); // required in some browsers

//       processor.onaudioprocess = (e) => {
//         const input = e.inputBuffer.getChannelData(0);
//         handleAudioChunk(input, ctx.sampleRate);
//       };

//       setRecording(true);
//       pushLog('Recording started');
//     } catch (err) {
//       console.error(err);
//       pushLog('Mic permission denied or unavailable');
//     }
//   }

//   function stopRecording() {
//     setRecording(false);
//     setSpeaking(false);

//     if (processorRef.current) {
//       try { processorRef.current.disconnect(); } catch {}
//       processorRef.current.onaudioprocess = null;
//       processorRef.current = null;
//     }

//     if (sourceRef.current) {
//       try { sourceRef.current.disconnect(); } catch {}
//       sourceRef.current = null;
//     }

//     if (audioCtxRef.current) {
//       try { audioCtxRef.current.close(); } catch {}
//       audioCtxRef.current = null;
//     }

//     if (streamRef.current) {
//       streamRef.current.getTracks().forEach(t => t.stop());
//       streamRef.current = null;
//     }

//     // If we were mid-utterance, finalize
//     if (vadTalkingRef.current) finalizeSegment();

//     pushLog('Recording stopped');
//   }

//   function handleAudioChunk(float32Mono, srcRate) {
//     // 1) Resample to 24k
//     const resampled = resampleLinear(float32Mono, srcRate, targetRate);

//     // 2) Append to accumulator
//     const old = resampleBufRef.current;
//     const merged = new Float32Array(old.length + resampled.length);
//     merged.set(old, 0);
//     merged.set(resampled, old.length);
//     resampleBufRef.current = merged;

//     // 3) Process in fixed frames (e.g., 480 samples = 20ms @ 24k)
//     const frameSize = 480; // 20ms
//     while (resampleBufRef.current.length >= frameSize) {
//       const frame = resampleBufRef.current.subarray(0, frameSize);
//       const remaining = resampleBufRef.current.subarray(frameSize);
//       const tmp = new Float32Array(remaining.length);
//       tmp.set(remaining, 0);
//       resampleBufRef.current = tmp;

//       // VAD on this frame
//       const rms = Math.sqrt(frame.reduce((acc, v) => acc + v * v, 0) / frame.length);
//       setLevel(rms);

//       const threshold = 0.015; // tweak as needed
//       const isSpeechNow = rms > threshold;

//       if (isSpeechNow) {
//         vadSilenceFramesRef.current = 0;
//         if (!vadTalkingRef.current) {
//           // Debounce: require a couple frames of speech
//           if (!speaking) setSpeaking(true);
//         }
//         // After enough speech frames, flip to talking
//         if (!vadTalkingRef.current) {
//           // Count contiguous speech frames via a hidden counter on the function scope
//           if (!handleAudioChunk._speechFrames) handleAudioChunk._speechFrames = 0;
//           handleAudioChunk._speechFrames++;
//           if (handleAudioChunk._speechFrames >= vadMinSpeechFrames) {
//             vadTalkingRef.current = true;
//             handleAudioChunk._speechFrames = 0;
//             pushLog('↗️ Speech start');
//           }
//         }
//       } else {
//         // silence frame
//         if (handleAudioChunk._speechFrames) handleAudioChunk._speechFrames = 0;
//         if (vadTalkingRef.current) {
//           vadSilenceFramesRef.current++;
//           if (vadSilenceFramesRef.current >= vadSilenceFramesToCommit) {
//             // End of utterance
//             vadTalkingRef.current = false;
//             vadSilenceFramesRef.current = 0;
//             setSpeaking(false);
//             finalizeSegment();
//             pushLog('↘️ Speech end → commit');
//           }
//         }
//       }

//       // Send frame only when talking (and a short tail while silenceFrames < vadSilenceFramesToCommit)
//       if (vadTalkingRef.current || vadSilenceFramesRef.current > 0) {
//         sendPcm16Frame(frame);
//       }
//     }
//   }

//   function finalizeSegment() {
//     // Tell model we are done with this utterance and request a response
//     safeSend({ type: 'input_audio_buffer.commit' });
//     safeSend({ type: 'response.create', response: { modalities: ['text', 'audio'] } });
//   }

//   function sendPcm16Frame(floatFrame) {
//     const pcm16 = floatToPCM16(floatFrame);
//     const b64 = uint8ToBase64(pcm16);
//     safeSend({ type: 'input_audio_buffer.append', audio: b64 });
//   }

//   function safeSend(obj) {
//     const ws = wsRef.current;
//     if (!ws || ws.readyState !== WebSocket.OPEN) return;
//     try { ws.send(JSON.stringify(obj)); } catch {}
//   }

//   // --- DSP helpers ---
//   function resampleLinear(float32, srcRate, dstRate) {
//     if (srcRate === dstRate) return float32;
//     const ratio = dstRate / srcRate;
//     const newLen = Math.floor(float32.length * ratio);
//     const out = new Float32Array(newLen);
//     let pos = 0;
//     for (let i = 0; i < newLen; i++) {
//       const x = i / ratio;
//       const x0 = Math.floor(x);
//       const x1 = Math.min(x0 + 1, float32.length - 1);
//       const t = x - x0;
//       out[i] = (1 - t) * float32[x0] + t * float32[x1];
//     }
//     return out;
//   }

//   function floatToPCM16(float32) {
//     const out = new Uint8Array(float32.length * 2);
//     let o = 0;
//     for (let i = 0; i < float32.length; i++) {
//       let s = Math.max(-1, Math.min(1, float32[i]));
//       s = s < 0 ? s * 0x8000 : s * 0x7FFF;
//       const val = s | 0; // to int
//       out[o++] = val & 0xFF; // little-endian
//       out[o++] = (val >> 8) & 0xFF;
//     }
//     return out;
//   }

//   function uint8ToBase64(u8) {
//     // Convert bytes to binary string, then btoa
//     let s = '';
//     const chunk = 0x8000; // avoid call stack limits
//     for (let i = 0; i < u8.length; i += chunk) {
//       s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
//     }
//     return btoa(s);
//   }

//   return (
//     <div className="mx-auto max-w-xl p-6">
//       <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow">
//         <h1 className="text-2xl font-semibold">Realtime Mic Streamer</h1>
//         <p className="mt-1 text-sm text-gray-500">Streams PCM16 chunks to your WS as you speak.</p>

//         <div className="mt-4 flex items-center gap-3">
//           <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${connected ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-600'}`}>
//             <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-gray-400'}`}></span>
//             {connected ? 'Connected' : 'Disconnected'}
//           </span>
//           <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${recording ? 'bg-indigo-50 text-indigo-700' : 'bg-gray-50 text-gray-600'}`}>
//             <span className={`h-2 w-2 rounded-full ${recording ? 'bg-indigo-500 animate-pulse' : 'bg-gray-400'}`}></span>
//             {recording ? 'Recording' : 'Idle'}
//           </span>
//           <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${speaking ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-600'}`}>
//             <span className={`h-2 w-2 rounded-full ${speaking ? 'bg-amber-500' : 'bg-gray-400'}`}></span>
//             {speaking ? 'Speaking' : 'Silent'}
//           </span>
//         </div>

//         <div className="mt-6">
//           <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
//             <div
//               className="h-full rounded-full bg-indigo-500 transition-all"
//               style={{ width: `${Math.min(100, Math.round(level * 600))}%` }}
//             />
//           </div>
//           <p className="mt-1 text-xs text-gray-500">Input level (RMS)</p>
//         </div>

//         <div className="mt-6">
//           {!recording ? (
//             <button
//               onClick={startRecording}
//               disabled={!connected}
//               className="w-full rounded-2xl bg-indigo-600 px-5 py-3 text-white shadow hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
//             >
//               Start Mic
//             </button>
//           ) : (
//             <button
//               onClick={stopRecording}
//               className="w-full rounded-2xl bg-rose-600 px-5 py-3 text-white shadow hover:bg-rose-700"
//             >
//               Stop Mic
//             </button>
//           )}
//         </div>

//         <div className="mt-6">
//           <h2 className="text-sm font-medium text-gray-700">Events</h2>
//           <ul className="mt-2 space-y-1 text-xs text-gray-600">
//             {log.map((l, i) => (
//               <li key={i} className="truncate">• {l}</li>
//             ))}
//           </ul>
//         </div>

//         <div className="mt-6 rounded-xl bg-gray-50 p-4 text-xs text-gray-600">
//           <p className="font-medium">How it works</p>
//           <ol className="mt-2 list-decimal space-y-1 pl-5">
//             <li>Connects to <code>{WS_URL}</code>.</li>
//             <li>Captures mic → resamples to 24kHz PCM16.</li>
//             <li>Simple VAD gates frames; sends <code>input_audio_buffer.append</code>.</li>
//             <li>On silence, sends <code>input_audio_buffer.commit</code> + <code>response.create</code>.</li>
//           </ol>
//         </div>
//       </div>
//     </div>
//   );
// }




import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * RealtimeMicStreamer.jsx (React + JS + Tailwind)
 *
 * AudioWorklet version — no ScriptProcessor deprecation.
 * Streams near‑real‑time mic audio to your websocket as base64 PCM16 @ 24kHz.
 * Includes simple VAD and better WS diagnostics.
 */

export default function RealtimeMicStreamer() {
  const [connected, setConnected] = useState(false);
  const [recording, setRecording] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [level, setLevel] = useState(0);
  const [log, setLog] = useState([]);

  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const workletNodeRef = useRef(null);
  const sourceRef = useRef(null);
  const streamRef = useRef(null);

  // Resampler state (Float32 accumulator at 24kHz)
  const resampleBufRef = useRef(new Float32Array(0));
  const targetRate = 24000; // matches session.input_audio_format = 'pcm16'

  // VAD state
  const vadTalkingRef = useRef(false);
  const vadSilenceFramesRef = useRef(0);
  const vadMinSpeechFrames = 2;
  const vadSilenceFramesToCommit = 8; // ~8 * 20ms = 160ms of silence

  const WS_URL = useMemo(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.hostname || 'localhost';
    return `${proto}://${host}:4000/ws`;
  }, []);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      setConnected(true);
      pushLog('Connected to proxy WS');
    });

    ws.addEventListener('close', (e) => {
      setConnected(false);
      pushLog(`WS closed code=${e.code} reason=${e.reason || 'n/a'}`);
      stopRecording();
    });

    ws.addEventListener('error', () => {
      pushLog('WebSocket error (check server path/port/protocol)');
    });

    // Optional: surface model/server events
    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'server.ready') pushLog('Server ready');
        if (typeof data.type === 'string') pushLog(`← ${data.type}`);
      } catch {
        // ignore non-JSON
      }
    });

    return () => {
      try { ws.close(); } catch {}
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [WS_URL]);

  function pushLog(msg) {
    setLog((l) => [msg, ...l].slice(0, 10));
  }

  async function startRecording() {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      pushLog('WS not connected');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true },
        video: false,
      });
      streamRef.current = stream;

      const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
      audioCtxRef.current = ctx;

      // Build a tiny worklet that transfers Float32 frames to main thread.
      const workletCode = `
        class PCMRelay extends AudioWorkletProcessor {
          process(inputs) {
            const input = inputs[0];
            if (input && input[0]) {
              const chan = input[0];
              // copy to transferable buffer
              const out = new Float32Array(chan.length);
              out.set(chan);
              this.port.postMessage(out, [out.buffer]);
            }
            return true;
          }
        }
        registerProcessor('pcm-relay', PCMRelay);
      `;
      const blobURL = URL.createObjectURL(new Blob([workletCode], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(blobURL);

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const node = new AudioWorkletNode(ctx, 'pcm-relay', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 });
      workletNodeRef.current = node;

      node.port.onmessage = (ev) => {
        const float32 = ev.data; // Float32Array @ ctx.sampleRate (likely 48k)
        handleAudioChunk(float32, ctx.sampleRate);
      };

      source.connect(node);
      // Do not connect to destination to avoid echo.

      setRecording(true);
      pushLog('Recording started (AudioWorklet)');
    } catch (err) {
      console.error(err);
      pushLog('AudioWorklet failed; trying legacy fallback…');
      // Fallback to ScriptProcessor if needed
      legacyStart();
    }
  }

  async function legacyStart() {
    try {
      const stream = streamRef.current || await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
      streamRef.current = stream;

      const ctx = audioCtxRef.current || new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const processor = ctx.createScriptProcessor(2048, 1, 1);
      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        handleAudioChunk(input, ctx.sampleRate);
      };

      source.connect(processor);
      processor.connect(ctx.destination);
      workletNodeRef.current = processor; // just for unified cleanup
      setRecording(true);
      pushLog('Recording started (fallback)');
    } catch (err) {
      console.error(err);
      pushLog('Mic permission denied or unavailable');
    }
  }

  function stopRecording() {
    setRecording(false);
    setSpeaking(false);

    if (workletNodeRef.current) {
      try { workletNodeRef.current.disconnect(); } catch {}
      workletNodeRef.current = null;
    }

    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch {}
      sourceRef.current = null;
    }

    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (vadTalkingRef.current) finalizeSegment();
    pushLog('Recording stopped');
  }

  // === Audio pipeline ===
  function handleAudioChunk(float32Mono, srcRate) {
    // 1) Resample to 24k
    const resampled = resampleLinear(float32Mono, srcRate, targetRate);

    // 2) Append to accumulator
    const old = resampleBufRef.current;
    const merged = new Float32Array(old.length + resampled.length);
    merged.set(old, 0);
    merged.set(resampled, old.length);
    resampleBufRef.current = merged;

    // 3) Process in 20ms frames (480 samples @ 24k)
    const frameSize = 480;
    while (resampleBufRef.current.length >= frameSize) {
      const frame = resampleBufRef.current.subarray(0, frameSize);
      const remaining = resampleBufRef.current.subarray(frameSize);
      const tmp = new Float32Array(remaining.length);
      tmp.set(remaining, 0);
      resampleBufRef.current = tmp;

      // VAD
      const rms = Math.sqrt(frame.reduce((acc, v) => acc + v * v, 0) / frame.length);
      setLevel(rms);
      const threshold = 0.015;
      const isSpeechNow = rms > threshold;

      if (isSpeechNow) {
        vadSilenceFramesRef.current = 0;
        if (!vadTalkingRef.current) {
          if (!handleAudioChunk._speechFrames) handleAudioChunk._speechFrames = 0;
          handleAudioChunk._speechFrames++;
          if (handleAudioChunk._speechFrames >= vadMinSpeechFrames) {
            vadTalkingRef.current = true;
            setSpeaking(true);
            handleAudioChunk._speechFrames = 0;
            pushLog('↗️ Speech start');
          }
        }
      } else {
        if (handleAudioChunk._speechFrames) handleAudioChunk._speechFrames = 0;
        if (vadTalkingRef.current) {
          vadSilenceFramesRef.current++;
          if (vadSilenceFramesRef.current >= vadSilenceFramesToCommit) {
            vadTalkingRef.current = false;
            vadSilenceFramesRef.current = 0;
            setSpeaking(false);
            finalizeSegment();
            pushLog('↘️ Speech end → commit');
          }
        }
      }

      // Send frames while speaking (and a short tail)
      if (vadTalkingRef.current || vadSilenceFramesRef.current > 0) {
        sendPcm16Frame(frame);
      }
    }
  }

  function finalizeSegment() {
    safeSend({ type: 'input_audio_buffer.commit' });
    safeSend({ type: 'response.create', response: { modalities: ['text', 'audio'] } });
  }

  function sendPcm16Frame(floatFrame) {
    const pcm16 = floatToPCM16(floatFrame);
    const b64 = uint8ToBase64(pcm16);
    safeSend({ type: 'input_audio_buffer.append', audio: b64 });
  }

  function safeSend(obj) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify(obj)); } catch {}
  }

  // === DSP helpers ===
  function resampleLinear(float32, srcRate, dstRate) {
    if (srcRate === dstRate) return float32;
    const ratio = dstRate / srcRate;
    const newLen = Math.floor(float32.length * ratio);
    const out = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      const x = i / ratio;
      const x0 = Math.floor(x);
      const x1 = Math.min(x0 + 1, float32.length - 1);
      const t = x - x0;
      out[i] = (1 - t) * float32[x0] + t * float32[x1];
    }
    return out;
  }

  function floatToPCM16(float32) {
    const out = new Uint8Array(float32.length * 2);
    let o = 0;
    for (let i = 0; i < float32.length; i++) {
      let s = Math.max(-1, Math.min(1, float32[i]));
      s = s < 0 ? s * 0x8000 : s * 0x7FFF;
      const val = s | 0;
      out[o++] = val & 0xFF; // LE
      out[o++] = (val >> 8) & 0xFF;
    }
    return out;
  }

  function uint8ToBase64(u8) {
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow">
        <h1 className="text-2xl font-semibold">Realtime Mic Streamer</h1>
        <p className="mt-1 text-sm text-gray-500">AudioWorklet + VAD. Streams PCM16 chunks to your WS as you speak.</p>

        <div className="mt-4 flex items-center gap-3">
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${connected ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-600'}`}>
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-gray-400'}`}></span>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${recording ? 'bg-indigo-50 text-indigo-700' : 'bg-gray-50 text-gray-600'}`}>
            <span className={`h-2 w-2 rounded-full ${recording ? 'bg-indigo-500 animate-pulse' : 'bg-gray-400'}`}></span>
            {recording ? 'Recording' : 'Idle'}
          </span>
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${speaking ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-600'}`}>
            <span className={`h-2 w-2 rounded-full ${speaking ? 'bg-amber-500' : 'bg-gray-400'}`}></span>
            {speaking ? 'Speaking' : 'Silent'}
          </span>
        </div>

        <div className="mt-6">
          <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all"
              style={{ width: `${Math.min(100, Math.round(level * 600))}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-gray-500">Input level (RMS)</p>
        </div>

        <div className="mt-6">
          {!recording ? (
            <button
              onClick={startRecording}
              disabled={!connected}
              className="w-full rounded-2xl bg-indigo-600 px-5 py-3 text-white shadow hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Start Mic
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="w-full rounded-2xl bg-rose-600 px-5 py-3 text-white shadow hover:bg-rose-700"
            >
              Stop Mic
            </button>
          )}
        </div>

        <div className="mt-6">
          <h2 className="text-sm font-medium text-gray-700">Events</h2>
          <ul className="mt-2 space-y-1 text-xs text-gray-600">
            {log.map((l, i) => (
              <li key={i} className="truncate">• {l}</li>
            ))}
          </ul>
        </div>

        <div className="mt-6 rounded-xl bg-gray-50 p-4 text-xs text-gray-600">
          <p className="font-medium">Troubleshooting connection</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>Page over <code>https://</code> → use <code>wss://</code>; page over <code>http://</code> → use <code>ws://</code>.</li>
            <li>Ensure server path is <code>/ws</code> and port <code>4000</code> is reachable.</li>
            <li>Update server forwarder: <code>oa.send(buf.toString())</code> (not <code>JSON.stringify(msg)</code>).</li>
            <li>Check server logs for close codes (policy errors, auth, etc.).</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
