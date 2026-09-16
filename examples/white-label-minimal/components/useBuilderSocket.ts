"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { watchBuild, type BuildState } from "../lib/chat/build-stream";

export function useBuilderSocket(appId: string | null) {
  const [state, setState] = useState<BuildState>({ app: null, messages: [] });
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [settled, setSettled] = useState("");
  const current = useRef<ReturnType<typeof watchBuild> | null>(null);
  const key = `${appId}:${revision}`;

  useEffect(() => {
    if (!appId) return;
    const stream = watchBuild(appId, next => {
      setState(next);
      setError("");
      setSettled(`${appId}:${revision}`);
    }, message => {
      setError(message);
      setSettled(`${appId}:${revision}`);
    });
    current.current = stream;
    return () => { stream.close(); current.current = null; };
  }, [appId, revision]);

  const refresh = useCallback(async () => { await current.current?.refresh(); }, []);
  const resume = () => { setError(""); setRevision(value => value + 1); };
  const visible = state.app?.id === appId ? state : { app: null, messages: [] };
  return { ...visible, error, loading: !!appId && settled !== key, refresh, resume };
}
