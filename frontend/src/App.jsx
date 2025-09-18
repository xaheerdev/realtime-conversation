import React,{useState} from 'react'
import VoiceChat from './components/VoiceChat'
import RealtimeMicStreamer from './components/RealtimeMicStreamer'
import VapiVisualizer from './components/VapiVisulizer'
import ChatGPT from './components/ChatGPT'



const App = () => {
  return (
    <div>
      <header style={{padding:12, textAlign:'center'}}>
        <h2 style={{color:'#111', fontFamily:'system-ui'}}>Vapi Blocks — Debug UI</h2>
      </header>
      <div className="min-h-screen grid place-items-center ">
      <ChatGPT />
    </div>
     {/* <RealtimeMicStreamer  />  */}
    </div>
  )
}

export default App
