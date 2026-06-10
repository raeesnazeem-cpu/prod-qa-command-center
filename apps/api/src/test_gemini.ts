import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

async function testGemini() {
  const genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY || '' });
  try {
    console.log('Testing gemini-2.0-flash...');
    const response = await genAI.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: 'Hello' }] }]
    });
    console.log('Success!', response.text);
  } catch (error: any) {
    console.error('Failed!', error.message);
  }
}

testGemini();
