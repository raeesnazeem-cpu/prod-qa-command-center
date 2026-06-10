import { TOOL_DEFINITIONS } from '../../packages/ai/src/chatTools';
import dotenv from 'dotenv';
dotenv.config();

// Individual functions must be exported temporarily or the call must be mocked.
import { chatWithFallback } from './src/lib/aiProviders';

const test = async () => {
  const messages = [{ role: 'system', content: 'You are a test agent' }, { role: 'user', content: 'hello' }];
  
  // Observe failures by checking the `failedProviders` output when triggering a tool.
  const complexMessages = [
    { role: 'user', content: 'Can you list all the projects?' }
  ];

  try {
    const res = await chatWithFallback(complexMessages as any, TOOL_DEFINITIONS, async (name, args) => { return "tool executed: " + name; });
    console.log("Success:", res);
    console.log("Failed:", res.failedProviders);
    console.log("Stats:", res.allStats);
  } catch (err) {
    console.error("Test failed:", err);
  }
};
test();
