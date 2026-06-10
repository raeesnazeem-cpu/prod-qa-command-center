import React, { useState } from 'react';
import { CheckCircle2, X, Loader2, ClipboardList } from 'lucide-react';
import { CanDo } from './CanDo';
import { useSignOff } from '../hooks/useRuns';

interface SignOffButtonProps {
  runId: string;
  onSuccess?: () => void;
}

export const SignOffButton: React.FC<SignOffButtonProps> = ({ runId, onSuccess }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const { mutate: signOff, isPending } = useSignOff();

  const handleSignOff = () => {
    signOff(
      { runId, notes },
      {
        onSuccess: () => {
          setIsOpen(false);
          setNotes('');
          onSuccess?.();
        },
      }
    );
  };

  return (
    <>
      <CanDo role="project_manager">
        <button
          onClick={() => setIsOpen(true)}
          className="btn-unified flex items-center space-x-2"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>Sign Off Run</span>
        </button>
      </CanDo>

      {/* Confirmation Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-200">
          <div 
            className="absolute inset-0 bg-transparent" 
            onClick={() => !isPending && setIsOpen(false)} 
          />
          
          <div className="relative w-full max-w-md bg-slate-50 border border-slate-200 rounded-lg shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center space-x-2 text-emerald-600">
                <CheckCircle2 className="w-5 h-5" />
                <h2 className="text-lg font-bold text-slate-900">Sign Off QA Run</h2>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                disabled={isPending}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-md">
                <p className="text-sm text-emerald-800 font-medium leading-relaxed">
                  By signing off, you confirm that this QA run has been reviewed and meets the release standards. This action will be recorded.
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700 flex items-center">
                  <ClipboardList className="w-4 h-4 mr-2 text-slate-400" />
                  Sign-off Notes <span className="text-slate-400 text-[10px] uppercase ml-1">(Optional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any final comments or context..."
                  className="w-full h-32 bg-slate-50 border border-slate-200 rounded-md p-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 transition-all resize-none"
                  disabled={isPending}
                />
              </div>

              <div className="flex space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  disabled={isPending}
                  className="btn-unified-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSignOff}
                  disabled={isPending}
                  className="btn-unified flex-[2] flex items-center justify-center space-x-2"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Confirm Sign-off</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
