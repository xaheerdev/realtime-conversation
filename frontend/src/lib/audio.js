export function floatTo16BitPCM(float32Array) {
  const out = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function downsampleTo24kHz(float32, srcRate) {
  const dstRate = 24000;
  if (srcRate === dstRate) return floatTo16BitPCM(float32);
  const ratio = srcRate / dstRate;
  const len = Math.round(float32.length / ratio);
  const out = new Int16Array(len);
  let pos = 0;
  for (let i = 0; i < len; i++) {
    const next = Math.round((i + 1) * ratio);
    let sum = 0, count = 0;
    while (pos < next && pos < float32.length) { sum += float32[pos++]; count++; }
    const avg = count ? sum / count : 0;
    const s = Math.max(-1, Math.min(1, avg));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function pcm16ToBase64(pcm16) {
  const buf = new Uint8Array(pcm16.buffer);
  // base64
  let binary = '';
  for (let i = 0; i < buf.byteLength; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary);
}
