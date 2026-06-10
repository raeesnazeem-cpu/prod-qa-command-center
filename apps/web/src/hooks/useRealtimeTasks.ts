import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/**
 * Hook to listen for realtime task updates via Supabase broadcast.
 * Automatically invalidates relevant React Query caches when an update is received.
 */
export const useRealtimeTasks = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Subscribe to the "tasks" channel
    const channel = supabase.channel('tasks');

    channel
      .on(
        'broadcast',
        { event: 'task_updated' },
        (payload) => {
          console.log('[Realtime] Received task update:', payload);
          
          const taskId = payload.payload?.taskId;

          // 1. Invalidate the specific task detail query if it exists
          if (taskId) {
            queryClient.invalidateQueries({
              queryKey: ['tasks', taskId]
            });
          }

          // 2. Invalidate all task lists
          queryClient.invalidateQueries({
            queryKey: ['tasks'],
            exact: false
          });

          // 3. Invalidate dashboard stats (ensure counts like "Open Issues" update)
          queryClient.invalidateQueries({
            queryKey: ['dashboard-stats'],
            exact: false
          });

          // 4. Invalidate projects (ensure project-level issue counts update)
          queryClient.invalidateQueries({
            queryKey: ['projects'],
            exact: false
          });
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] Successfully subscribed to tasks channel');
        }
        if (status === 'CLOSED') {
          console.log('[Realtime] Subscription to tasks channel closed');
        }
        if (status === 'CHANNEL_ERROR') {
          console.error('[Realtime] Error connecting to tasks channel');
        }
      });

    // Cleanup subscription on unmount
    return () => {
      console.log('[Realtime] Unsubscribing from tasks channel');
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
};
