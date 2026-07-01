import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useRole } from './useRole';
import toast from 'react-hot-toast';

/**
 * Hook to listen for realtime notifications for the current user.
 * Subscribes to database changes on the 'notifications' table.
 */
export const useRealtimeNotifications = () => {
  const queryClient = useQueryClient();
  const { profile, isAdmin } = useRole();

  useEffect(() => {
    if (!profile?.id) return;

    console.log(`[Realtime] Subscribing to notifications broadcast for user ${profile.id}`);

    const channel = supabase
      .channel(`notifications:${profile.id}`)
      .on(
        'broadcast',
        { event: 'new_notification' },
        (payload) => {
          console.log('[Realtime] New notification broadcast detected:', payload);
          
          // 1. Invalidate the notifications list to trigger a refetch
          queryClient.invalidateQueries({
            queryKey: ['notifications']
          });

          // 2. Show a toast alert
          toast.success('New notification!', {
            icon: '🔔',
            duration: 5000,
            position: 'top-right'
          });

          // 3. Play a subtle sound if enabled (optional)
          const dingEnabled = profile?.notification_prefs?.ding ?? true;
          if (dingEnabled) {
            try {
              const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
              audio.volume = 0.4;
              audio.play().catch(() => {}); // Ignore errors if browser blocks autoplay
            } catch (e) {
              // Silently fail if audio setup fails
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] Subscribed to notifications broadcast channel');
        }
      });

    return () => {
      console.log('[Realtime] Unsubscribing from notifications broadcast channel');
      supabase.removeChannel(channel);
    };
  }, [profile?.id, queryClient, profile?.notification_prefs?.ding]);
};
