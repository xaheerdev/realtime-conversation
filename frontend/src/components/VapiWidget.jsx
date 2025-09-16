import { VapiWidget } from '@vapi-ai/client-sdk-react';

const VapiWidgets = () => {
  return (
    <VapiWidget
      publicKey="43f718ab-70ff-45fc-90ed-35cd221530b5"
      assistantId="acaaaa36-ca54-413a-907b-7faea6ab5353"
      mode="hybrid"
      position="bottom-right"
      theme="light"
      accentColor="#3B82F6"
      title="AI Assistant"
      chatPlaceholder="Ask me anything..."
      voiceShowTranscript={true}
    />
  )
}

export default VapiWidgets
