// GlobVisulizer.jsx
import React, { useState, useEffect } from 'react';
import AbstractBall from './AbstractBall';
import useRealtime from '../hooks/use-realtime';
import { MicIcon, PhoneOff, Zap } from 'lucide-react';

const GlobVisulizer = () => {
  const { volumeLevel, isSessionActive, toggleCall, enableWakeListener } = useRealtime(); // ← add enableWakeListener
  const [wakeArmed, setWakeArmed] = useState(false);

  const [config, setConfig] = useState({ /* ...unchanged... */ });

  useEffect(() => {
    if (isSessionActive && volumeLevel > 0) {
      setConfig(prev => ({ ...prev, perlinTime: 100.0, perlinMorph: 25.0 }));
    } else {
      if (isSessionActive) {
        setConfig(prev => ({ ...prev, perlinTime: 25.0, perlinMorph: 10.0 }));
      } else {
        setConfig(prev => ({ ...prev, perlinTime: 5.0, perlinMorph: 0 }));
      }
    }
  }, [isSessionActive, volumeLevel]);

  //! ✅ start wake listener automatically (no button required)
    useEffect(() => {
      enableWakeListener?.(); 
    }, [enableWakeListener]);

  //! Optional: arm wake word automatically the first time the user clicks mic
  const onToggleCall = async () => {
    if (!wakeArmed) {
      enableWakeListener();
      setWakeArmed(true);
    }
    await toggleCall();
  };

  return (
    <div style={{ width: '100%', height: '50%' }}>
      <AbstractBall {...config} />

      <div className="flex items-center justify-center gap-3 mt-0">
        {/* Arm wake word explicitly (recommended) */}
        {/* <button
          onClick={() => { enableWakeListener(); setWakeArmed(true); }}
          disabled={wakeArmed}
          className={`m-2 rounded-full px-4 py-2 ${wakeArmed ? 'bg-green-100' : 'bg-yellow-100'}`}
          title="Enable the passive 'Hey Siri' listener"
        >
          <span className="inline-flex items-center gap-2">
            <Zap size={18} /> {wakeArmed ? 'Wake word armed' : 'Enable “Hey Siri”'}
          </span>
        </button> */}

        {/* Start/stop session (also auto-arms on first click) */}
        <button onClick={onToggleCall} className='m-2 bg-gray-200 rounded-full p-3'>
          {isSessionActive ? <PhoneOff size={40} className='text-red-600' /> : <MicIcon size={40} className='text-blue-800' />}
        </button>
      </div>
    </div>
  );
};

export default GlobVisulizer;
