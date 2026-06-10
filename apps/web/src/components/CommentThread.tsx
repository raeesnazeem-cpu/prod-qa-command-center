import { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Bot, 
  MessageSquare,
  Clock
} from 'lucide-react';
import { format } from 'date-fns';
import { TaskComment, TaskRebuttal } from '../api/tasks.api';
import { useAddComment } from '../hooks/useTasks';

interface CommentThreadProps {
  taskId: string;
  comments: TaskComment[];
  rebuttals?: TaskRebuttal[];
}

type ThreadItem = 
  | (TaskComment & { itemType: 'comment' })
  | (TaskRebuttal & { itemType: 'rebuttal' });

export const CommentThread = ({ taskId, comments, rebuttals = [] }: CommentThreadProps) => {
  const [newComment, setNewComment] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const { mutate: addComment, isPending: isSubmitting } = useAddComment();

  // Merge and sort in chronological order
  const threadItems: ThreadItem[] = [
    ...comments.map(c => ({ ...c, itemType: 'comment' as const })),
    ...rebuttals.map(r => ({ ...r, itemType: 'rebuttal' as const }))
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  // Auto-scroll to bottom on new items
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [threadItems]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || isSubmitting) return;

    addComment({ taskId, content: newComment.trim() }, {
      onSuccess: () => {
        setNewComment('');
      }
    });
  };

  const getInitials = (name?: string) => {
    if (!name) return '?';
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase();
  };

  return (
    <div className="flex flex-col h-full max-h-[600px]">
      <div className="flex items-center space-x-2 mb-4">
        <MessageSquare className="w-4 h-4 text-slate-400" />
        <h3 className="font-bold text-slate-900 dark:text-white uppercase tracking-widest text-xs">Discussion</h3>
      </div>

      {/* Comment List */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar mb-4"
      >
        {threadItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center opacity-40">
            <MessageSquare className="w-8 h-8 mb-2" />
            <p className="text-xs font-medium dark:text-slate-300">No comments yet. Start the conversation.</p>
          </div>
        ) : (
          threadItems.map((item) => {
            const isRebuttal = item.itemType === 'rebuttal';
            const isAI = item.itemType === 'comment' && item.is_ai_generated;
            
            const content = isRebuttal ? item.text : item.content;

            return (
              <div key={item.id} className="flex space-x-3 group animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-[#1d2a31] flex items-center justify-center text-[10px] font-bold text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 shrink-0">
                  {isAI ? <Bot className="w-4 h-4 text-blue-900" /> : getInitials(item.users?.full_name)}
                </div>
                
                <div className="flex-1 space-y-1 min-w-0">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        {isAI ? 'AI Agent' : item.users?.full_name || 'Unknown User'}
                      </span>
                      {isAI && (
                        <span className="inline-flex items-center bg-blue-900 text-white text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter">
                          <Bot className="w-3 h-3 mr-1" />
                          AI Analysis
                        </span>
                      )}
                      {isRebuttal && (
                        <span className="inline-flex items-center bg-blue-100 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter border border-blue-200">
                          Rebuttal
                        </span>
                      )}
                    </div>
                    <div className="flex items-center text-[10px] text-slate-400">
                      <Clock className="w-2.5 h-2.5 mr-1" />
                      {format(new Date(item.created_at), 'MMM d, HH:mm')}
                    </div>
                  </div>
                  
                  <div className={`text-sm text-slate-600 dark:text-slate-300 p-3 rounded-xl rounded-tl-none border break-words ${
                    isAI 
                      ? 'bg-blue-50/30 dark:bg-blue-900/30 border-blue-900 dark:border-blue-800 italic' // Navy border equivalent
                      : isRebuttal
                        ? 'bg-blue-50/50 dark:bg-blue-900/20 border-blue-500 dark:border-blue-700 shadow-sm' // Blue border
                        : 'bg-slate-50 dark:bg-[#1D2A31] border-slate-100 dark:border-slate-800'
                  }`}>
                    {content}
                    {isRebuttal && item.screenshot_url && (
                      <div className="mt-3">
                        <img 
                          src={item.screenshot_url} 
                          alt="Rebuttal evidence" 
                          className="max-h-48 rounded-lg border border-slate-200 object-contain shadow-sm"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="relative group">
        <textarea 
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          placeholder="Add a comment... (Enter to send)"
          className="w-full bg-slate-50 dark:bg-[#1D2A31] border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm dark:text-white focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/5 min-h-[80px] pr-12 transition-all resize-none shadow-sm group-hover:border-slate-300 dark:group-hover:border-slate-600"
          disabled={isSubmitting}
        />
        <button 
          type="submit"
          className={`absolute right-3 bottom-3 p-2 rounded-lg transition-all active:scale-95 ${
            newComment.trim() && !isSubmitting
              ? 'bg-[#000000] dark:bg-white text-white dark:text-black hover:bg-[#93C0B1]'
              : 'bg-slate-100 dark:bg-[#1d2a31] text-slate-400 dark:text-slate-500 cursor-not-allowed'
          }`}
          disabled={!newComment.trim() || isSubmitting}
        >
          <Send className={`w-4 h-4 ${isSubmitting ? 'animate-pulse' : ''}`} />
        </button>
      </form>
    </div>
  );
};
