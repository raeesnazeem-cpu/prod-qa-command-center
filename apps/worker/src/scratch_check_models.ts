import "dotenv/config";
import { genAI } from "../../../packages/ai/src/geminiClient";

async function main() {
  const key = process.env.GOOGLE_AI_API_KEY || "";
  console.log("Using API Key:", key ? `FOUND (length: ${key.length}, prefix: ${key.substring(0, 7)}...)` : "NOT FOUND");
  try {
    const list = await genAI.models.list();
    console.log("Total models count:", list.models?.length || 0);
    
    console.log("\nTesting gemini-1.5-flash generation...");
    try {
      const response = await genAI.models.generateContent({
        model: "gemini-1.5-flash",
        contents: "Hello, answer in one word."
      });
      console.log("gemini-1.5-flash response:", response.text());
    } catch (e: any) {
      console.error("gemini-1.5-flash failed:", e.message || e);
    }

    console.log("\nTesting gemini-2.5-flash generation...");
    try {
      const response = await genAI.models.generateContent({
        model: "gemini-2.5-flash",
        contents: "Hello, answer in one word."
      });
      console.log("gemini-2.5-flash response:", response.text);
    } catch (e: any) {
      console.error("gemini-2.5-flash failed:", e.message || e);
    }
  } catch (error) {
    console.error("Failed to list models:", error);
  }
}

main();
