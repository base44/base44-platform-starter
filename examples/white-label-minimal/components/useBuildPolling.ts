'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getApp, getConversation } from '../lib/builder-api';
import type { App, Message } from '../lib/types';
import { refreshConversation } from '../lib/conversation';

export function useBuildPolling(appId: string | null) {
  const [app, setApp] = useState<App | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const refreshNow = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!appId) return;
    let stopped = false;
    let transcript: Message[] = [];
    let timer: ReturnType<typeof setTimeout>;
    let flight: Promise<void> | null = null;
    const controller = new AbortController();
    function refresh(): Promise<void> {
      if (flight) return flight;
      clearTimeout(timer);
      flight = (async () => {
        try {
          const [appResult, conversationResult] = await Promise.allSettled([
            getApp(appId!, controller.signal),
            refreshConversation(transcript, skip => getConversation(appId!, skip, controller.signal)),
          ]);
          if (stopped) return;
          // Settle both reads even if one fails, so a retry cannot overlap the other.
          if (appResult.status === 'rejected') throw appResult.reason;
          if (conversationResult.status === 'rejected') throw conversationResult.reason;
          const current = appResult.value;
          const conversation = conversationResult.value;
          transcript = conversation;
          setApp(current); setMessages(conversation); setError('');
          timer = setTimeout(refresh, current.status?.state === 'processing' ? 2_000 : 10_000);
        } catch (err) {
          if (!stopped) setError(err instanceof Error ? err.message : 'Polling failed.');
        } finally { flight = null; }
      })();
      return flight;
    }
    refreshNow.current = async () => {
      // A mutation needs a read started AFTER it finished, not an older in-flight read.
      if (flight) await flight;
      if (!stopped) await refresh();
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [appId, revision]);

  const refresh = useCallback(() => refreshNow.current(), []);
  const resume = () => setRevision(n => n + 1);
  return { app, messages, error, refresh, resume };
}
