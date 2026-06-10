import { chatWithFallback } from './src/lib/aiProviders';
import { TOOL_DEFINITIONS } from '../../packages/ai/src/chatTools';
import dotenv from 'dotenv';
dotenv.config();

const test = async () => {
  try {
    const messages = [{ role: 'user', content: 'hello' }];
    const res = await chatWithFallback(messages as any, TOOL_DEFINITIONS, async () => { return "tool executed"; });
    console.log("Success:", res);
  } catch (err) {
    console.error("Test failed:", err);
  }
};
test();
