import React,{useState} from 'react'
import VoiceChat from './components/VoiceChat'
import RealtimeMicStreamer from './components/RealtimeMicStreamer'
import VapiVisualizer from './components/VapiVisulizer'





const App = () => {
  return (
    <div>
      <div className="min-h-screen grid place-items-center ">
      <VapiVisualizer />
    </div>
     {/* <RealtimeMicStreamer  />  */}
    </div>
  )
}

export default App
