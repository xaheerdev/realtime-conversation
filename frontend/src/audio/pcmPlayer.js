// src/lib/pcmPlayer.js
export function createPCM16Player() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
  let playHead = 0; // seconds on the AudioContext timeline

  function appendPCM16(int16) {
    const n = int16.length;
    const buf = ctx.createBuffer(1, n, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = Math.max(-1, Math.min(1, int16[i] / 32768));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, playHead);
    src.start(startAt);
    playHead = startAt + buf.duration;
  }

  function reset() { playHead = Math.max(ctx.currentTime, playHead); }
  function close() { try { ctx.close(); } catch {} }

  return { appendPCM16, reset, close, ctx };
}
