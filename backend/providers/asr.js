export function startStream({ onPartial, onFinal, onError }) {
  let closed = false;

  // Example: feed PCM16 frames to provider
  function pushAudio(buffer) {
    if (closed) return;
    // forward to provider socket
  }

  function endUtterance() {
    // signal endpoint to ASR if supported
  }

  function close() {
    closed = true;
    // close provider stream
  }

  // Simulate partials for now
  // setTimeout(() => onPartial('listening...'), 200);

  return { pushAudio, endUtterance, close };
}
