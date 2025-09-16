import { Conversation } from "../models/conversation.js";
export async function* callLLMAsChunks(prompt) {
  // Replace with your provider’s streaming API
  // yield chunks like "Hello", " there", "!" as they arrive
}

 export async function streamReply({ conversationId }) {
  const convo = await Conversation.findById(conversationId);
  const prompt = convo.messages.map(m => `${m.role}: ${m.text}`).join('\n');

  let cancelled = false;
  const cancel = () => { cancelled = true; };

  async function* fullText() {
    for await (const chunk of callLLMAsChunks(prompt)) {
      if (cancelled) break;
      yield chunk;
    }
  }

  // Also persist assistant message at the end
  (async () => {
    let text = '';
    for await (const c of fullText()) text += c;
    if (!cancelled) {
      await Conversation.findByIdAndUpdate(conversationId, {
        $push: { messages: { role: 'assistant', text } }
      });
    }
  })();

  return { fullText: fullText(), cancel };
}
