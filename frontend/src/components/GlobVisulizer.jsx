import React, { useState, useEffect } from 'react';
import AbstractBall from './AbstractBall';
import useRealtime from '../hooks/use-realtime';
import { MicIcon, PhoneOff } from 'lucide-react';
 
const GlobVisulizer = () => {
  const { volumeLevel, isSessionActive, toggleCall } = useRealtime();
  const [config, setConfig] = useState({
    perlinTime: 50.0,
    perlinDNoise: 2.5,
    chromaRGBr: 7.5,
    chromaRGBg: 5,
    chromaRGBb: 7,
    chromaRGBn: 0,
    chromaRGBm: 1.0,
    sphereWireframe: false,
    spherePoints: false,
    spherePsize: 1.0,
    cameraSpeedY: 0.0,
    cameraSpeedX: 0.0,
    cameraZoom: 175,
    cameraGuide: false,
    perlinMorph: 5.5,
  });
 
  useEffect(() => {
    if (isSessionActive && volumeLevel > 0) {
      setConfig(prevConfig => ({
        ...prevConfig,
        perlinTime: 100.0,
        perlinMorph: 25.0,
      }));
    } 
    else{ 
      if (isSessionActive) {
        setConfig(prevConfig => ({
          ...prevConfig,
          perlinTime: 25.0,
          perlinMorph: 10.0,
        }));
      }
      else{
      setConfig(prevConfig => ({
        ...prevConfig,
        perlinTime: 5.0,
        perlinMorph: 0,
      }));
      }
    }
  }, [isSessionActive, volumeLevel]);
 
  return (
    <div style={{ width: '100%', height: '50%' }}>
      {/* <ConfigSheet config={config} setConfig={setConfig} /> */}
     
      <AbstractBall {...config} />
    
      <div className="flex justify-center mt-0 ">
        <button onClick={toggleCall} className='m-2 bg-gray-200 rounded-full p-3 '>
          {isSessionActive ? <PhoneOff size={40} className='text-red-600' /> : <MicIcon size={40} className='text-blue-800' />}
        </button>
      </div>
    </div>
  );
};
 
export default GlobVisulizer;