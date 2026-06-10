import Groq from 'groq-sdk';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

async function testGroq() {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || '' });
  try {
    console.log('Testing Groq llama-3.3-70b-versatile...');
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'Hello' }]
    });
    console.log('Success!', response.choices[0].message.content);
  } catch (error: any) {
    console.error('Failed!', error.message);
  }
}

testGroq();
