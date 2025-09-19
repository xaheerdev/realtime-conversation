
import React, { useState, useEffect, useRef } from 'react';
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition';

const Dictaphone = () => {
  const {
    transcript,
    listening,
    resetTranscript,
    browserSupportsSpeechRecognition
  } = useSpeechRecognition();

  const [showMicModal, setShowMicModal] = useState(false);
  const closeBtnRef = useRef(null);

  useEffect(() => {
    if (showMicModal) {
      // Move focus to close for accessibility
      closeBtnRef.current?.focus();
    }
  }, [showMicModal]);

  if (!browserSupportsSpeechRecognition) {
    return <span>Browser doesn&apos;t support speech recognition.</span>;
  }

  const startContinuous = () =>
    SpeechRecognition.startListening({
      continuous: true,
      interimResults: true,
      language: 'en-US',
    });

  const handleMicClick = () => {
    if (listening) {
      SpeechRecognition.stopListening();
    } else {
      // This triggers the browser mic permission prompt (if not granted yet)
      startContinuous();
    }
  };

  const handleOpenMicModal = () => setShowMicModal(true);
  const handleCloseMicModal = () => {
    setShowMicModal(false);
    // Do not force-stop; let user keep dictating with modal closed if they want
    // If you prefer to stop when closing, uncomment:
SpeechRecognition.stopListening()
  };

  const handleBackdropClick = (e) => {
    if (e.target.dataset.backdrop) handleCloseMicModal();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') handleCloseMicModal();
  };

  return (
    <div onKeyDown={handleKeyDown}>
      <p>Microphone: {listening ? 'on' : 'off'}</p>

      {/* Opens YouTube-like mic popup */}
      <button onClick={handleOpenMicModal}>Start</button>

      {/* Explicit stop/reset still available */}
      <button onClick={SpeechRecognition.stopListening}>Stop</button>
      <button onClick={resetTranscript}>Reset</button>

      <p>{transcript}</p>

      {showMicModal && (
        <div
          data-backdrop
          onClick={handleBackdropClick}
          aria-modal="true"
          role="dialog"
          aria-label="Voice input"
          style={styles.backdrop}
        >
          <div style={styles.modal}>
            <button
              ref={closeBtnRef}
              onClick={handleCloseMicModal}
              aria-label="Close"
              style={styles.close}
            >
              ✕
            </button>

            <div style={styles.title}>Tap the mic and speak</div>

            <button
              onClick={handleMicClick}
              aria-pressed={listening}
              aria-label={listening ? 'Stop listening' : 'Start listening'}
              style={{
                ...styles.micButton,
                ...(listening ? styles.micButtonActive : {}),
              }}
            >
              {/* Simple mic icon */}
              <svg
                width="42"
                height="42"
                viewBox="0 0 24 24"
                aria-hidden="true"
                style={{ display: 'block' }}
              >
                <path
                  d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21H9v2h6v-2h-2v-3.08A7 7 0 0 0 19 11h-2Z"
                  fill="currentColor"
                />
              </svg>
            </button>

            <div style={styles.hint}>
              {listening
                ? 'Listening… click mic to stop'
                : 'Click the mic to start'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Inline styles to keep it drop-in; move to CSS if you prefer.
const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  modal: {
    position: 'relative',
    width: 'min(92vw, 420px)',
    borderRadius: '16px',
    background: '#111',
    color: '#fff',
    padding: '28px 24px 32px',
    textAlign: 'center',
    boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
  },
  title: {
    fontSize: '18px',
    fontWeight: 600,
    marginBottom: '20px',
  },
  micButton: {
    width: 96,
    height: 96,
    borderRadius: '999px',
    border: 'none',
    background: '#2a2a2a',
    color: '#fff',
    cursor: 'pointer',
    outline: 'none',
    boxShadow: '0 6px 16px rgba(0,0,0,0.35)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'transform 120ms ease, box-shadow 120ms ease, background 120ms ease',
  },
  micButtonActive: {
    background: '#d32f2f',
    transform: 'scale(1.05)',
    boxShadow: '0 10px 24px rgba(211,47,47,0.5)',
  },
  hint: {
    marginTop: 12,
    fontSize: 14,
    opacity: 0.85,
  },
  close: {
    position: 'absolute',
    right: 10,
    top: 10,
    width: 34,
    height: 34,
    borderRadius: 8,
    border: 'none',
    background: 'transparent',
    color: '#bbb',
    cursor: 'pointer',
    fontSize: 20,
    lineHeight: '34px',
  },
};

export default Dictaphone;