// providers/tts.js (ESM)
export function isSentenceBoundary(s) {
  return /[.!?]\s$/.test(s);
}

export async function streamSpeak({ textSource, onAudio, onStart, onEnd }) {
  let cancelled = false;
  onStart?.();

  async function doTTS(text) {
    // TODO: call your provider and for each PCM16 Buffer -> onAudio(buffer)
  }

  (async () => {
    try {
      let sentence = '';
      for await (const chunk of textSource) {
        if (cancelled) return;
        sentence += chunk;
        if (isSentenceBoundary(sentence)) {
          await doTTS(sentence);
          sentence = '';
        }
      }
      if (!cancelled && sentence.trim()) {
        await doTTS(sentence);
      }
    } finally {
      onEnd?.();
    }
  })();

  return { cancel: () => { cancelled = true; } };
}
