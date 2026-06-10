import dotenv from 'dotenv';
dotenv.config({ path: '/Users/ikkaavaforever/Documents/Work/react-projects/audio-video-add/apps/api/.env' });

async function run() {
  const { TOOL_DEFINITIONS } = await import('../../packages/ai/src/chatTools.js');
  const { chatWithFallback } = await import('./src/lib/aiProviders.js');

  const complexMessages = [
    { role: 'user', content: 'Can you list all the projects?' }
  ];

  try {
    const res = await chatWithFallback(complexMessages as any, TOOL_DEFINITIONS, async (name, args) => { return "tool executed: " + name; });
    console.log("Failed:", res.failedProviders);
    console.log("Stats:", res.allStats);
  } catch (err) {
    console.error("Test failed:", err);
  }
}
run();
