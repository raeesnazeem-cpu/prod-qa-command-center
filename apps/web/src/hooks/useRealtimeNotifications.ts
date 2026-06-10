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
  const { profile } = useRole();

  useEffect(() => {
    if (!profile?.id) return;

    console.log(`[Realtime] Subscribing to notifications for user ${profile.id}`);

    // Subscribe to INSERT events on the notifications table for this specific user
    const channel = supabase
      .channel(`user-notifications-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${profile.id}`
        },
        (payload) => {
          console.log('[Realtime] New notification row detected:', payload);
          
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
          try {
            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
            audio.volume = 0.4;
            audio.play().catch(() => {}); // Ignore errors if browser blocks autoplay
          } catch (e) {
            // Silently fail if audio setup fails
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] Subscribed to notifications channel');
        }
      });

    return () => {
      console.log('[Realtime] Unsubscribing from notifications channel');
      supabase.removeChannel(channel);
    };
  }, [profile?.id, queryClient]);
};
