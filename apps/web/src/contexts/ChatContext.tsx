import React, { createContext, useContext, ReactNode } from 'react';
import { useParams } from 'react-router-dom';

interface ChatContextType {
  currentProjectId?: string;
  currentRunId?: string;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { id, runId } = useParams<{ id?: string; runId?: string }>();

  return (
    <ChatContext.Provider value={{ currentProjectId: id, currentRunId: runId }}>
      {children}
    </ChatContext.Provider>
  );
};

export const useChatContext = () => {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChatContext must be used within a ChatProvider');
  }
  return context;
};
