import Groq from 'groq-sdk';
import axios from 'axios';
import { GoogleGenAI } from '@google/genai';
import { logger } from './logger';
import fs from 'fs';
import path from 'path';
import os from 'os';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || '' });
const genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY || '' });

logger.info({ 
  hasGroqKey: !!process.env.GROQ_API_KEY,
  hasGeminiKey: !!process.env.GOOGLE_AI_API_KEY 
}, 'AI Providers Initialized');

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: any[];
}

export interface ProviderStats {
  latencyMs: number;
  status: 'success' | 'failed';
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

/**
 * Helper to truncate tool descriptions to reduce token usage (TPM).
 */
function truncateTools(tools: any[], maxLength = 120) {
  return tools.map(t => ({
    ...t,
    description: t.description?.slice(0, maxLength) ?? ''
  }));
}

/**
 * Selective tool loading to reduce token footprint for rate-limited providers.
 */
function getRelevantTools(messages: ChatMessage[], allTools: any[]) {
  const historyText = messages.map(m => (m.content || '')).join(' ').toLowerCase();
  
  // Core tools that are almost always needed for entity discovery
  const coreTools = ['find_project', 'find_user_by_name', 'list_projects', 'get_all_users'];
  
  const mutationKeywords = ['create', 'update', 'delete', 'add', 'remove', 'cancel', 'start', 'assign', 'set', 'clear'];
  const statsKeywords = ['stats', 'count', 'how many', 'total', 'summary', 'status'];
  const ragKeywords = ['search', 'about', 'issue', 'task', 'bug', 'problem', 'performance', 'login'];

  const categories = {
    mutation: mutationKeywords.some(k => historyText.includes(k)),
    stats: statsKeywords.some(k => historyText.includes(k)),
    rag: historyText.includes('search') || ragKeywords.some(k => historyText.includes(k))
  };

  return allTools.filter(t => {
    if (coreTools.includes(t.name)) return true;
    
    // Mutation tools
    if (t.name.startsWith('create_') || t.name.startsWith('update_') || t.name.startsWith('delete_') || 
        t.name.startsWith('add_') || t.name.startsWith('remove_') || t.name.startsWith('cancel_')) {
      return categories.mutation;
    }
    
    // Stats tools
    if (t.name.includes('_stats') || t.name.includes('_status') || t.name.includes('_issues_by_')) {
      return categories.stats;
    }

    // RAG tools
    if (t.name === 'search_issues') return categories.rag;

    // Default to including it if we can't categorize it
    return true; 
  });
}

/**
 * Helper to sanitize tools for Gemini (removes empty parameters).
 */
function sanitizeToolsForGemini(tools: any[]) {
  return tools.map(t => {
    const hasProps = t.parameters?.properties &&
      Object.keys(t.parameters.properties).length > 0;
    return {
      name: t.name,
      description: t.description?.slice(0, 120) ?? '',
      ...(hasProps ? { parameters: t.parameters } : {}),
    };
  });
}

/**
 * Main entry point for chat with fallback and agentic loop.
 */
export async function chatWithFallback(
  messages: ChatMessage[],
  tools: any[],
  toolCallHandler: (name: string, args: any) => Promise<any>,
  onUpdate?: (provider: string, stats: ProviderStats) => void
) {
  const providers = [
    { name: 'groq', fn: groqChat },
    { name: 'gemini', fn: geminiChat },
    { name: 'openrouter', fn: openrouterChat },
    { name: 'mistral', fn: mistralChat },
    { name: 'cohere', fn: cohereChat },
    { name: 'cerebras', fn: cerebrasChat }
  ];

  const failedProviders: string[] = [];
  const allStats: Record<string, ProviderStats> = {};
  let lastError: any = null;

  for (const provider of providers) {
    const startTime = Date.now();
    try {
      logger.info({ provider: provider.name }, 'Attempting AI completion');
      const result = await provider.fn(messages, tools, toolCallHandler);
      const latencyMs = Date.now() - startTime;
      
      allStats[provider.name] = { 
        latencyMs, 
        status: 'success',
        usage: result.usage
      };
      if (onUpdate) onUpdate(provider.name, allStats[provider.name]);

      return {
        ...result,
        provider: provider.name,
        failedProviders,
        allStats
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      failedProviders.push(provider.name);
      
      const errorMsg = error.response?.data?.error?.message || error.message;
      allStats[provider.name] = { latencyMs, status: 'failed', error: errorMsg };
      if (onUpdate) onUpdate(provider.name, allStats[provider.name]);
      
      lastError = error;
      logger.warn({ provider: provider.name, error: errorMsg }, 'AI provider failed, falling back');
      
      if (error.isToolError) throw error;
      continue;
    }
  }

  throw lastError || new Error('All AI providers failed');
}

/**
 * Helper for OpenAI-compatible providers
 */
async function openAiCompatibleChat(
  providerName: string,
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools: any[],
  toolCallHandler: (name: string, args: any) => Promise<any>
) {
  if (!apiKey) throw new Error(`Missing API key for ${providerName}`);
  
  let currentMessages = [...messages];
  let rounds = 0;
  const MAX_ROUNDS = 6;

  let totalUsage = { promptTokens: 0, completionTokens: 0 };
  const toolsPayload = tools.length > 0 ? tools.map(t => ({ type: 'function', function: t })) : undefined;

  while (rounds < MAX_ROUNDS) {
    const response = await axios.post(`${baseUrl}/chat/completions`, {
      model,
      messages: currentMessages,
      tools: toolsPayload,
      tool_choice: toolsPayload ? 'auto' : undefined,
    }, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    });

    if (response.data.usage) {
      totalUsage.promptTokens += response.data.usage.prompt_tokens || 0;
      totalUsage.completionTokens += response.data.usage.completion_tokens || 0;
    }

    const message = response.data.choices[0].message;
    currentMessages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return { content: message.content, history: currentMessages, usage: totalUsage };
    }

    for (const toolCall of message.tool_calls) {
      const name = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments);
      try {
        const result = await toolCallHandler(name, args);
        currentMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: name,
          content: JSON.stringify(result)
        });
      } catch (err: any) {
        currentMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: name,
          content: `Error: ${err.message}`
        });
      }
    }
    rounds++;
  }
  throw new Error(`Max tool calling rounds exceeded for ${providerName}`);
}

/**
 * Groq Provider (Primary)
 */
async function groqChat(messages: ChatMessage[], tools: any[], toolCallHandler: (name: string, args: any) => Promise<any>) {
  try {
    const relevantTools = getRelevantTools(messages, tools);
    const optimizedTools = truncateTools(relevantTools);
    return await openAiCompatibleChat('Groq', 'https://api.groq.com/openai/v1', process.env.GROQ_API_KEY || '', 'llama-3.3-70b-versatile', messages, optimizedTools, toolCallHandler);
  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack }, 'Groq Chat specifically failed');
    throw error;
  }
}

/**
 * OpenRouter Provider (Fallback 1)
 */
async function openrouterChat(messages: ChatMessage[], tools: any[], toolCallHandler: (name: string, args: any) => Promise<any>) {
  const models = [
    'nvidia/nemotron-3-nano-30b-a3b:free',
    'google/gemma-4-31b-it:free',
    'qwen/qwen3-coder:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'nvidia/nemotron-3-super-120b-a12b:free'
  ];

  const optimizedTools = truncateTools(tools);
  for (const model of models) {
    try {
      return await openAiCompatibleChat('OpenRouter', 'https://openrouter.ai/api/v1', process.env.OPENROUTER_API_KEY || '', model, messages, optimizedTools, toolCallHandler);
    } catch (err: any) {
      const isNoEndpoints = err?.message?.includes('No endpoints found');
      // Support both native HTTP status and axios response status
      const isRateLimit = err?.status === 429 || err?.response?.status === 429;
      const isNotFound = err?.status === 404 || err?.response?.status === 404;

      if (isNoEndpoints || isRateLimit || isNotFound) {
        logger.warn({ model, error: err.message }, `OpenRouter model ${model} unavailable, trying next...`);
        continue; // move to next model in list
      }
      throw err; // hard error, don't swallow it
    }
  }
  throw new Error('All OpenRouter free models exhausted');
}

/**
 * Gemini Provider (Fallback 2)
 */
async function geminiChat(messages: ChatMessage[], tools: any[], toolCallHandler: (name: string, args: any) => Promise<any>) {
  const systemMessage = messages.find(m => m.role === 'system')?.content || '';
  const safeTools = sanitizeToolsForGemini(tools);
  
  // Map history to Gemini format (user/model roles)
  const contents: any[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (msg.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: msg.content }] });
    } else if (msg.role === 'assistant') {
      const parts: any[] = [];
      if (msg.content) parts.push({ text: msg.content });
      if (msg.tool_calls) {
        parts.push(...msg.tool_calls.map(tc => ({
          functionCall: { name: tc.function.name, args: JSON.parse(tc.function.arguments) }
        })));
      }
      contents.push({ role: 'model', parts });
    } else if (msg.role === 'tool') {
      // Tool responses must follow a model turn with functionCalls
      const lastTurn = contents[contents.length - 1];
      if (lastTurn && lastTurn.role === 'user' && lastTurn.parts[0].functionResponse) {
        lastTurn.parts.push({
          functionResponse: { name: msg.name, response: { content: msg.content } }
        });
      } else {
        contents.push({
          role: 'user',
          parts: [{ functionResponse: { name: msg.name, response: { content: msg.content } } }]
        });
      }
    }
  }

  let rounds = 0;
  const MAX_ROUNDS = 6;
  let totalUsage = { promptTokens: 0, completionTokens: 0 };

  while (rounds < MAX_ROUNDS) {
    const modelsToTry = [
      'gemini-2.5-flash',
      'gemma-4-31b-it',
      'gemini-3.1-flash-lite'
    ];

    let response: any;
    let success = false;
    let lastError: any = null;

    for (const model of modelsToTry) {
      try {
        response = await genAI.models.generateContent({
          model: model,
          contents: contents,
          config: {
            systemInstruction: systemMessage,
            tools: [{ functionDeclarations: safeTools }],
            toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
          }
        });
        success = true;
        break;
      } catch (err: any) {
        lastError = err;
        logger.warn({ model, error: err.message }, `Gemini provider model ${model} failed, trying next...`);
        continue;
      }
    }

    if (!success) {
      throw lastError || new Error('All Gemini provider fallback models failed');
    }
    
    if (response.usageMetadata) {
      totalUsage.promptTokens += response.usageMetadata.promptTokenCount || 0;
      totalUsage.completionTokens += response.usageMetadata.candidatesTokenCount || 0;
    }

    const parts = response.candidates?.[0]?.content?.parts || [];
    const calls = parts.filter((p: any) => p.functionCall);

    if (!calls || calls.length === 0) {
      return { content: response.text || parts.map((p: any) => p.text).join(''), history: [], usage: totalUsage };
    }

    // Append the model's tool calls to contents
    contents.push({ role: 'model', parts });

    const toolResponses: any[] = [];
    for (const call of calls) {
      const name = call.functionCall!.name;
      const args = call.functionCall!.args;
      try {
        const data = await toolCallHandler(name, args);
        toolResponses.push({
          functionResponse: { name, response: { content: data } }
        });
      } catch (err: any) {
        toolResponses.push({
          functionResponse: { name, response: { content: { error: err.message } } }
        });
      }
    }

    contents.push({ role: 'user', parts: toolResponses });
    rounds++;
  }
  throw new Error('Max tool calling rounds exceeded in Gemini');
}

/**
 * Mistral AI Provider (Fallback 3)
 */
async function mistralChat(messages: ChatMessage[], tools: any[], toolCallHandler: (name: string, args: any) => Promise<any>) {
  return openAiCompatibleChat('Mistral', 'https://api.mistral.ai/v1', process.env.MISTRAL_API_KEY || '', 'mistral-small-latest', messages, tools, toolCallHandler);
}

/**
 * Cohere Provider (Fallback 4)
 */
async function cohereChat(messages: ChatMessage[], tools: any[], toolCallHandler: (name: string, args: any) => Promise<any>) {
  return openAiCompatibleChat('Cohere', 'https://api.cohere.com/v1/compatibility/openai/v1', process.env.COHERE_API_KEY || '', 'command-r', messages, tools, toolCallHandler);
}

/**
 * Cerebras Provider (Fallback 5)
 */
async function cerebrasChat(messages: ChatMessage[], tools: any[], toolCallHandler: (name: string, args: any) => Promise<any>) {
  const optimizedTools = truncateTools(tools);
  return await openAiCompatibleChat('Cerebras', 'https://api.cerebras.ai/v1', process.env.CEREBRAS_API_KEY || '', 'llama-3.3-70b', messages, optimizedTools, toolCallHandler);
}
/**
 * Transcribe audio using Groq Whisper
 */
export async function transcribeAudio(audioBuffer: Buffer) {
  const tempFilePath = path.join(os.tmpdir(), `audio_${Date.now()}.webm`);
  fs.writeFileSync(tempFilePath, audioBuffer);
  
  try {
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-large-v3',
    });
    return transcription.text;
  } catch (error: any) {
    logger.error({ error: error.message }, 'Groq transcription failed');
    throw error;
  } finally {
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (err) {
        // Ignore unlink errors
      }
    }
  }
}
