import { useState, useCallback } from 'react';
import { useAuth } from '@clerk/react';
import { Citation } from '../components/ChatMessage';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  citations?: Citation[];
}

export const useChat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [providerMetadata, setProviderMetadata] = useState<{ 
    provider: string, 
    failedProviders: string[],
    allStats?: Record<string, { 
      latencyMs: number, 
      status: string, 
      error?: string,
      usage?: { promptTokens: number, completionTokens: number }
    }>
  } | null>(null);
  const { getToken } = useAuth();

  const sendMessage = useCallback(async (text: string, projectId?: string, runId?: string) => {
    if (!text.trim()) return;

    const userMessage: Message = {
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const token = await getToken();
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text,
          project_id: projectId,
          run_id: runId,
          history: messages.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      setIsLoading(false);
      setIsStreaming(true);

      const assistantMessage: Message = {
        role: 'assistant',
        content: '',
        timestamp: new Date(),

        isStreaming: true,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = '';
      let partialLine = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = (partialLine + chunk).split('\n');
        partialLine = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          
          const data = line.slice(6);

          if (data === '[DONE]') {
            setIsStreaming(false);
            setMessages((prev) => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];
              if (lastMessage && lastMessage.role === 'assistant') {
                lastMessage.isStreaming = false;
              }
              return newMessages;
            });
            continue;
          }

          if (data.startsWith('[METADATA]')) {
            try {
              const meta = JSON.parse(data.slice(10));
              if (meta.intermediate) {
                setProviderMetadata((prev) => {
                  const newStats = { ...(prev?.allStats || {}), [meta.provider]: meta.stats };
                  return {
                    provider: meta.stats.status === 'success' ? meta.provider : (prev?.provider || ''),
                    failedProviders: Object.entries(newStats)
                      .filter(([_, s]) => s.status === 'failed')
                      .map(([name]) => name),
                    allStats: newStats
                  };
                });
              } else {
                setProviderMetadata(meta);
              }
            } catch (e) {
              console.error('Error parsing metadata:', e);
            }
            continue;
          }

          try {
            // Check if it's a JSON object (citations or error)
            if (data.startsWith('{')) {
              const parsed = JSON.parse(data);
              if (parsed.citations) {
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastMessage = newMessages[newMessages.length - 1];
                  if (lastMessage && lastMessage.role === 'assistant') {
                    lastMessage.citations = parsed.citations;
                  }
                  return newMessages;
                });
              } else if (parsed.error) {
                throw new Error(parsed.error);
              }
            } else {
              // It's a plain text chunk
              accumulatedContent += data || '\n';
              setMessages((prev) => {
                const newMessages = [...prev];
                const lastMessage = newMessages[newMessages.length - 1];
                if (lastMessage && lastMessage.role === 'assistant') {
                  lastMessage.content = accumulatedContent;
                }
                return newMessages;
              });
            }
          } catch (e) {
            // Handle cases where text might look like JSON but isn't
            accumulatedContent += data;
            setMessages((prev) => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];
              if (lastMessage && lastMessage.role === 'assistant') {
                lastMessage.content = accumulatedContent;
              }
              return newMessages;
            });
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      setIsLoading(false);
      setIsStreaming(false);
      // Optionally handle error in UI
    }
  }, [getToken, messages]);

  return {
    messages,
    isLoading,
    isStreaming,
    providerMetadata,
    sendMessage,
  };
};
