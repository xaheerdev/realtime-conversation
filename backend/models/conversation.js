// models/conversation.js
import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
  text: String,
  asr: {
    raw: Object,
    startMs: Number,
    endMs: Number,
  },
  tts: {
    provider: String,
    voice: String,
    charCount: Number,
  },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const ConversationSchema = new mongoose.Schema({
  userId: String,
  title: String,
  messages: [MessageSchema],
  meta: { type: Object, default: {} },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

ConversationSchema.pre('save', function(next){
  this.updatedAt = new Date();
  next();
});

export const Conversation = mongoose.model('Conversation', ConversationSchema);
