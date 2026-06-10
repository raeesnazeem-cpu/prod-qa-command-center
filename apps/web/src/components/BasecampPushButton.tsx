import { ExternalLink, Loader2, CheckCircle2 } from 'lucide-react';
import { Task } from '../api/tasks.api';
import { usePushToBasecamp } from '../hooks/useTasks';
import { CanDo } from './CanDo';

interface BasecampPushButtonProps {
  task: Task;
  onPush: () => void;
  isPending: boolean;
  isSuccess?: boolean;
}

export const BasecampTaskLink = ({ url }: { url: string | undefined }) => {
  if (!url) return null;
  return (
    <div className="flex flex-col space-y-1">
      <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Basecamp</span>
      <div className="flex items-center space-x-2 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1.5 rounded-md border border-emerald-100 dark:border-emerald-800/50">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <a 
          href={url} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-xs font-bold hover:underline flex items-center"
        >
          Synced ✓ View in Basecamp
          <ExternalLink className="w-3 h-3 ml-1" />
        </a>
      </div>
    </div>
  );
};

export const BasecampPushButton = ({ task, onPush, isPending, isSuccess }: BasecampPushButtonProps) => {

  return (
    <CanDo role="qa_engineer">
      <div className="flex flex-col space-y-1">
        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Integration</span>
        <button 
          onClick={onPush}
          disabled={isPending || isSuccess}
          className={`inline-flex items-center justify-center space-x-2 px-4 py-1.5 rounded-md font-bold text-xs transition-all shadow-sm active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed ${
            isPending 
              ? 'bg-slate-100 dark:bg-[#1d2a31] text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700' 
              : isSuccess
                ? 'bg-emerald-500 dark:bg-emerald-600 text-white'
                : 'bg-[#F97316] dark:bg-[#EA580C] text-white hover:bg-[#EA580C] dark:hover:bg-[#C2410C]'
          }`}
        >
          {isPending ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Pushing...</span>
            </>
          ) : isSuccess ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Success!</span>
            </>
          ) : (
            <>
              <span>Push to </span>
              <svg width="18" height="18" viewBox="0 0 35 30" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="pl-1"><path d="M18.088.27c9.1 0 15.215 10.518 15.977 21.937.02.313-.053.626-.212.896-3.14 5.35-10.061 6.527-15.737 6.558-5.487.1-10.7-2.188-14.412-6.301a1.566 1.566 0 0 1-.303-1.6 36.177 36.177 0 0 1 1.912-4.147c1.052-1.928 2.644-4.681 5.154-4.763 2.343 0 3.516 2.174 5.114 3.519 1.633-1.672 2.552-3.94 3.567-6.014a1.565 1.565 0 0 1 2.837 1.326c-.885 1.829-1.814 3.651-2.954 5.336-1.172 1.732-2.073 2.636-3.33 2.636-.746 0-1.385-.292-2.03-.801-1.103-.92-1.937-2.088-3.15-2.873-1.567.785-2.99 4.079-3.824 5.98 2.925 2.88 6.898 4.55 11.008 4.573 4.622-.028 10.286-.49 13.197-4.62-.575-7.111-4.013-18.377-12.814-18.51-7.097 0-11.754 5.047-14.775 13.644A1.565 1.565 0 1 1 .36 16.008C3.771 6.299 9.333.27 18.088.27Z"></path></svg>
            </>
          )}
        </button>
      </div>
    </CanDo>
  );
};
