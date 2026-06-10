import { GoogleGenAI } from "@google/genai";
import 'dotenv/config';

export const genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY || "" });
