/**
 * The App Builder — the whole Base44 integration, as a user sees it.
 *
 * A slide-over with two views: a list of the apps this user has built, and a chat
 * that drives one build. Everything it does goes through `src/lib/base44Platform.ts`
 * to the server proxy; nothing here holds a Base44 credential.
 *
 * The flow:
 *
 *   1. `useAuth().b44Linked` gates the UI. Not linked → a Connect button, which
 *      provisions this user's Base44 service principal and mints their token.
 *   2. First submit → `platform.createApp()` with the prompt, a locally-derived
 *      name, and `buildCustomInstructions()` — the text Base44's builder applies on
 *      every turn. Later submits → `platform.sendMessage()` on the same app.
 *   3. **Base44 builds asynchronously**, so there is no completion callback: this
 *      polls `getApp` + `getConversation` (fast while `status.state === "processing"`,
 *      slowly when idle) and re-renders from whatever the platform reports.
 *   4. A builder turn can *pause* on a tool call needing input — approval,
 *      clarifying questions, secrets. Those arrive as `tool_calls` with status
 *      `waiting_for_user_input`, get rendered as widgets
 *      (`src/components/builder/`), and resume the turn via
 *      `submitToolCallInput()`.
 *   5. Preview boots a sandbox (`getPreviewUrl`, up to ~40s) into an iframe; "Save
 *      to My Tools" deploys and records local ownership.
 *
 * Because every reply is awaited against a moving target, `shownAppIdRef` records
 * which app the chat is *meant* to be showing and every commit checks it first —
 * otherwise a poll that lands after the user navigates away re-hydrates the app it
 * was fetched for.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import * as platform from "@/lib/base44Platform";
import { Board } from "@/lib/entityClient";
import { useAuth } from "@/lib/AuthContext";
import { suggestAppName } from "@/lib/appName";
import { buildCustomInstructions } from "@/lib/builderInstructions";
import { addAppToMyWidgets } from "@/lib/myWidgets";
import { announceAppRebuilt } from "@/lib/appRefresh";
import { Widget as WidgetEntity } from "@/lib/entityClient";
import AppPreviewModal from "@/components/AppPreviewModal";
import { Textarea } from "@/components/ui/textarea";
import ReactMarkdown from "react-markdown";
import {
  Send,
  Plus,
  Loader2,
  AlertTriangle,
  Eye,
  ChevronDown,
  Bot,
  User,
  X,
  ChevronLeft,
  LayoutGrid,
  Sparkles,
  Hammer,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { widgetFor } from "@/components/builder/toolWidgets";
import AppReadyWidget from "@/components/builder/widgets/AppReadyWidget";
import PublishDialog from "@/components/market/PublishDialog";
import AppNameField from "@/components/AppNameField";

const BUILDING_POLL_MS = 2500;
const IDLE_POLL_MS = 8000;
const TOOL_PENDING = ["running", "waiting_for_user_input"];
const TOOL_FAILED = ["error", "stopped"];

function ToolCallDisplay({ toolCall }) {
  const [expanded, setExpanded] = useState(false);
  const isPending = TOOL_PENDING.includes(toolCall.status);
  const isFailed = TOOL_FAILED.includes(toolCall.status);
  let parsedArgs = null;
  try {
    parsedArgs = toolCall.arguments_string ? JSON.parse(toolCall.arguments_string) : null;
  } catch {}

  return (
    <div className="mt-2 text-xs border border-border rounded overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-secondary hover:bg-secondary/70 transition-colors text-left"
      >
        {isPending ? (
          <Loader2 className="w-3 h-3 animate-spin text-accent flex-shrink-0" />
        ) : isFailed ? (
          <span className="w-2 h-2 rounded-full bg-destructive flex-shrink-0" />
        ) : (
          <span className="w-2 h-2 rounded-full bg-foreground/40 flex-shrink-0" />
        )}
        <span className="font-medium text-foreground font-mono truncate">{toolCall.name}</span>
        <ChevronDown
          className={`w-3 h-3 ml-auto text-muted-foreground transition-transform flex-shrink-0 ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="px-3 py-2 space-y-2 bg-card text-muted-foreground">
          {toolCall.arguments_string && (
            <div>
              <p className="font-medium text-foreground mb-1 text-xs">Arguments:</p>
              <pre className="bg-secondary p-2 rounded text-xs overflow-auto max-h-32 whitespace-pre-wrap">
                {parsedArgs ? JSON.stringify(parsedArgs, null, 2) : toolCall.arguments_string}
              </pre>
            </div>
          )}
          {toolCall.results && (
            <div>
              <p className="font-medium text-foreground mb-1 text-xs">Result:</p>
              <pre className="bg-secondary p-2 rounded text-xs overflow-auto max-h-32 whitespace-pre-wrap">
                {toolCall.results}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function renderToolCall(tc, i, { message, appId, isLastAssistant, onSubmitted }) {
  const Widget = widgetFor(tc);
  if (!Widget) return <ToolCallDisplay key={tc.id || i} toolCall={tc} />;

  let parsedArgs = null;
  try {
    parsedArgs = tc.arguments_string ? JSON.parse(tc.arguments_string) : null;
  } catch {}

  return (
    <Widget
      key={tc.id || i}
      toolCall={tc}
      parsedArgs={parsedArgs}
      isLastRunningTool={isLastAssistant && tc.status === "running"}
      appId={appId}
      messageId={message.id}
      onSubmitted={onSubmitted}
    />
  );
}

function MessageBubble({ message, appId, isLastAssistant, onSubmitted }) {
  const isUser = message.role === "user";
  const text =
    typeof message.content === "string"
      ? message.content
      : platform.messageText?.(message.content) || "";
  const toolCalls = message.tool_calls || [];
  if (!text && toolCalls.length === 0) return null;

  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={`flex-shrink-0 w-6 h-6 rounded flex items-center justify-center ${isUser ? "bg-primary text-primary-foreground" : "bg-secondary border border-border text-muted-foreground"}`}
      >
        {isUser ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
      </div>
      <div className={`max-w-[82%] flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
        {text && (
          <div
            className={`px-3 py-2 rounded text-xs leading-relaxed ${isUser ? "bg-primary text-primary-foreground" : "bg-card border border-border text-foreground"}`}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap">{text}</p>
            ) : (
              <ReactMarkdown className="prose prose-xs max-w-none prose-p:text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-pre:bg-secondary prose-code:text-foreground">
                {text}
              </ReactMarkdown>
            )}
          </div>
        )}
        {toolCalls.map((tc, i) =>
          renderToolCall(tc, i, { message, appId, isLastAssistant, onSubmitted }),
        )}
      </div>
    </div>
  );
}

export default function AppBuilderSidebar({
  open,
  onClose,
  initialMode,
  initialAppId,
  origin,
  requestId,
}) {
  // App build state
  const [apps, setApps] = useState([]);
  const [isLoadingApps, setIsLoadingApps] = useState(false);
  const [activeApp, setActiveApp] = useState(null);
  const [buildMessages, setBuildMessages] = useState([]);
  const [buildInput, setBuildInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [buildView, setBuildView] = useState("list"); // "list" | "chat"

  const { b44Linked } = useAuth();
  // Mirror context value so local app-list loading still works after link
  const [linked, setLinked] = useState(null);

  const [error, setError] = useState(null);
  // A send in flight. The composer holds the text until the conversation carries
  // it; `userCount` is the fallback for when the server normalises what it stores.
  const [pendingSend, setPendingSend] = useState(null);
  // Which turn the ready card was dismissed for. Openness itself is derived below.
  const [dismissedReadyFor, setDismissedReadyFor] = useState(null);
  // Server truth, so re-entering cannot offer to pin an already-pinned app.
  const [alreadyPinned, setAlreadyPinned] = useState(false);
  // Covers the window before the commit hash catches up.
  const [editedAppId, setEditedAppId] = useState(null);
  // Which filing action is in flight, and what the app was ultimately filed as.
  // Single values rather than a pair of booleans per action: the reset sites are
  // many, and two flags could fall out of step.
  const [pendingSave, setPendingSave] = useState(null); // null | "my-tools" | "widgets"
  const [savedAs, setSavedAs] = useState(null); //         null | "my-tools" | "widgets"
  const isSavingToMyTools = pendingSave !== null;
  /**
   * Is the build on disk the one that was deployed? Comparing commits, not just
   * `last_deployed_at`, is what re-arms Publish after an edit. Non-git sources
   * report no hashes, so fall back to "ever deployed".
   */
  // `last_git_commit_hash` only moves once the build commits, long after the user
  // asked for the change, so the deploy state below would read stale until then.
  const editedSinceDeploy = editedAppId !== null && editedAppId === activeApp?.id;

  const deployedCommit = activeApp?.last_deployed_git_commit_hash ?? null;
  const currentCommit = activeApp?.last_git_commit_hash ?? null;
  const deployedUpToDate =
    Boolean(activeApp?.last_deployed_at) &&
    (!deployedCommit || !currentCommit || deployedCommit === currentCommit);

  // Session state for the moment after the click, server truth for later visits.
  const savedToMyTools = !editedSinceDeploy && (savedAs !== null || deployedUpToDate);
  const addedToMyWidgets = savedAs === "widgets";
  const [boardSuggestions, setBoardSuggestions] = useState([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewModalUrl, setPreviewModalUrl] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const messagesEndRef = useRef(null);

  // The app the chat is *intended* to be showing. Every awaited refresh checks it
  // before committing, so a reply that lands after the user moved on is dropped
  // rather than re-hydrating the app it was fetched for. Without this the idle
  // poll can restore `activeApp` a moment after "create new" cleared it, and the
  // next submit edits the previous app instead of creating one.
  const shownAppIdRef = useRef(null);
  // Same idea for the preview poll loop, which runs for up to 40s.
  const previewReqRef = useRef(0);
  // One refresh at a time. A conversation fetch can outlast the poll interval —
  // the transcript grows all build long — and overlapping refreshes each re-fetch
  // a bigger body, so they queue up behind each other until the proxy's timeout
  // fires. The symptom is intermittent `getConversation` timeouts on a build that
  // is otherwise progressing fine.
  const refreshInFlightRef = useRef(false);

  const activeAppId = activeApp?.id || null;
  const isBuilding = activeApp?.status?.state === "processing";

  // Where the builder was opened from is already a statement of intent, so it picks
  // the finished app's primary destination rather than asking. From the Add-widget
  // picker: pin it. From the market: list it. Everything lands in My Tools regardless.
  const cameFromWidgetPicker = origin === "home-widget";
  const cameFromMarket = origin === "market";
  const [marketApp, setMarketApp] = useState(null);
  const [listedInMarket, setListedInMarket] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [buildMessages]);

  // Open a specific app in the build chat when initialAppId is provided
  useEffect(() => {
    if (open && initialAppId && linked === true) {
      shownAppIdRef.current = initialAppId;
      setBuildView("chat");
      setActiveApp(null);
      setBuildMessages([]);
      setError(null);
      setDismissedReadyFor(null);
      setSavedAs(null);
      platform
        .getApp(initialAppId)
        .then((app) => {
          if (shownAppIdRef.current !== initialAppId) return null;
          setActiveApp(app);
          return platform.getConversation(initialAppId, { limit: 100 });
        })
        .then((conv) => {
          if (!conv || shownAppIdRef.current !== initialAppId) return;
          const visible = (conv?.messages || []).filter((m) => !m.hidden);
          setBuildMessages(visible);
        })
        .catch((err) => setError(err.message));
    }
    // Keyed on the request, so re-opening the same app reloads it.
  }, [open, requestId, initialAppId, linked]);

  // Load boards to generate contextual suggestions
  useEffect(() => {
    Board.list("-updated_date", 6)
      .then((boards) => {
        if (!boards || boards.length === 0) {
          setBoardSuggestions([
            "A habit tracker with streaks",
            "An expense splitter for roommates",
            "A reading list with ratings",
          ]);
          return;
        }
        const templates = [
          (b) => `A weekly status report emailer for "${b.title}"`,
          (b) => `A public-facing progress tracker for "${b.title}"`,
          (b) => `A Kanban board with time estimates for "${b.title}"`,
          (b) => `A client portal to view tasks from "${b.title}"`,
          (b) => `An automated standup generator based on "${b.title}"`,
          (b) => `A workload heatmap for "${b.title}"`,
        ];
        const suggestions = boards.slice(0, 3).map((b, i) => templates[i % templates.length](b));
        setBoardSuggestions(suggestions);
      })
      .catch(() => {
        setBoardSuggestions([
          "A habit tracker with streaks",
          "An expense splitter for roommates",
          "A reading list with ratings",
        ]);
      });
  }, []);

  // Sync linked state from context
  useEffect(() => {
    if (b44Linked === null) return;
    setLinked(b44Linked);
  }, [b44Linked]);

  // Load apps whenever we enter build mode and are linked
  useEffect(() => {
    if (linked !== true) return;
    setIsLoadingApps(true);
    platform
      .listAppsForUser({ limit: 25 })
      .then((list) => setApps(list))
      .catch(() => {})
      .finally(() => setIsLoadingApps(false));
  }, [linked]);

  // Poll for build updates
  const refresh = useCallback(async (appId) => {
    const [app, conversation] = await Promise.all([
      platform.getApp(appId),
      platform.getConversation(appId, { limit: 100 }),
    ]);
    // The list row is always safe to freshen — it is keyed by id either way.
    setApps((prev) => prev.map((a) => (a.id === app.id ? { ...a, ...app } : a)));
    // The chat is not: if the user has since gone back or started a new app,
    // committing here would put the old conversation back on screen.
    if (shownAppIdRef.current !== appId) return;
    const visible = (conversation?.messages || []).filter((m) => !m.hidden);
    setActiveApp(app);
    setBuildMessages(visible);
  }, []);

  useEffect(() => {
    if (!activeAppId) return;
    const id = setInterval(() => {
      if (refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;
      refresh(activeAppId)
        .catch(() => {})
        .finally(() => {
          refreshInFlightRef.current = false;
        });
    }, isBuilding ? BUILDING_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(id);
  }, [activeAppId, isBuilding, refresh]);

  // The one way to get to an empty composer. Clearing `shownAppIdRef` is the part
  // that matters: it invalidates any refresh already in flight for the app we are
  // leaving, so the next submit is guaranteed to hit `createApp`.
  const startNewApp = useCallback(() => {
    shownAppIdRef.current = null;
    setActiveApp(null);
    setBuildMessages([]);
    setError(null);
    setDismissedReadyFor(null);
    setSavedAs(null);
    setBuildView("chat");
  }, []);

  // Keyed on `requestId`, not the request's contents: asking twice for the same
  // thing must act twice, which "build a new app" while a chat is open needs.
  useEffect(() => {
    if (open && initialMode === "build") {
      setBuildView("chat");
      if (!initialAppId) startNewApp();
    }
  }, [open, requestId, initialMode, initialAppId, startNewApp]);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setBuildView("list");
      setError(null);
      // The modal lives inside the sidebar's tree, so closing the sidebar hides it
      // without clearing it — reopening would otherwise flash the last preview, or
      // a skeleton for a poll nobody is watching.
      previewReqRef.current++;
      setPreviewOpen(false);
      setPreviewModalUrl(null);
      setPreviewError(null);
      setIsLoadingPreview(false);
    }
  }, [open]);

  const saveToMyTools = async () => {
    if (!activeAppId || isSavingToMyTools) return;
    setPendingSave("my-tools");
    try {
      await platform.deployApp(activeAppId);
      await refresh(activeAppId);
      setSavedAs("my-tools");
      setEditedAppId((prev) => (prev === activeAppId ? null : prev));
      announceAppRebuilt(activeAppId);
    } catch (err) {
      if (platform.isNotLinkedError(err)) setLinked(false);
      setError(err.message);
    } finally {
      setPendingSave(null);
    }
  };

  /** Publishes and pins: a superset of `saveToMyTools`, not an alternative. */
  const addToMyWidgets = async () => {
    if (!activeAppId || isSavingToMyTools) return;
    setPendingSave("widgets");
    try {
      await platform.deployApp(activeAppId);
      await refresh(activeAppId);
      await addAppToMyWidgets({ ...activeApp, id: activeAppId });
      setSavedAs("widgets");
      setEditedAppId((prev) => (prev === activeAppId ? null : prev));
      announceAppRebuilt(activeAppId);
    } catch (err) {
      if (platform.isNotLinkedError(err)) setLinked(false);
      setError(err.message);
    } finally {
      setPendingSave(null);
    }
  };

  /**
   * Deploy, then ask for the listing. Deploying first is not optional: a listing
   * snapshots the app's deployed URL, and installers load that build rather than the
   * author's preview sandbox.
   */
  const addToMarket = async () => {
    if (!activeAppId || isSavingToMyTools) return;
    setPendingSave("market");
    try {
      await platform.deployApp(activeAppId);
      // getApp directly, not refresh(): the dialog needs `last_deployed_at` and the
      // slug from *this* moment, and refresh() commits to state without returning.
      const fresh = await platform.getApp(activeAppId);
      await refresh(activeAppId);
      announceAppRebuilt(activeAppId);
      setMarketApp({ ...fresh, id: activeAppId });
    } catch (err) {
      if (platform.isNotLinkedError(err)) setLinked(false);
      setError(err.message);
    } finally {
      setPendingSave(null);
    }
  };

  const handleRenamed = useCallback((id, name) => {
    setActiveApp((prev) => (prev?.id === id ? { ...prev, name } : prev));
    setApps((prev) => prev.map((a) => (a.id === id ? { ...a, name } : a)));
  }, []);

  // App build submit
  const submitBuild = async () => {
    const content = buildInput.trim();
    // Answer the pending user-input widget before sending a free-form message,
    // or it races into the paused turn.
    if (!content || isSending || pendingSend || awaitingInput) return;
    // Carrying on, so the card steps aside.
    if (appReady) setDismissedReadyFor(lastAssistantId);
    setSavedAs(null);
    setEditedAppId(activeApp?.id ?? null);
    // Deliberately not clearing the composer; the effect above retires it.
    setPendingSend({ text: content, userCount: userMessageCount });
    setIsSending(true);
    setError(null);
    try {
      if (!activeApp) {
        const name = suggestAppName(content);
        const app = await platform.createApp({
          prompt: content,
          name,
          customInstructions: buildCustomInstructions(),
        });
        shownAppIdRef.current = app.id;
        setApps((prev) => [app, ...prev]);
        setActiveApp(app);
        await refresh(app.id);
      } else {
        await platform.sendMessage(activeApp.id, content);
        await refresh(activeApp.id);
      }
    } catch (err) {
      if (platform.isNotLinkedError(err)) setLinked(false);
      setError(err.message);
      setPendingSend(null);
    } finally {
      setIsSending(false);
    }
  };

  const selectApp = async (app) => {
    shownAppIdRef.current = app.id;
    setActiveApp(app);
    setBuildMessages([]);
    setError(null);
    setDismissedReadyFor(null);
    setSavedAs(null);
    setBuildView("chat");
    try {
      await refresh(app.id);
    } catch (err) {
      setError(err.message);
    }
  };

  const backToList = () => {
    // Drop the conversation, not just the view. Leaving it mounted keeps the idle
    // poll running behind the list, and its reply is what used to reappear once
    // the user pressed "create new".
    shownAppIdRef.current = null;
    setActiveApp(null);
    setBuildMessages([]);
    setBuildView("list");
    setError(null);
    setDismissedReadyFor(null);
    setSavedAs(null);
  };

  const closePreview = () => {
    previewReqRef.current++; // abandon an in-flight poll
    setPreviewOpen(false);
    setPreviewModalUrl(null);
    setPreviewError(null);
    setIsLoadingPreview(false);
  };

  // So the effect above can reopen the preview without depending on it.
  const openPreviewRef = useRef(null);

  const openPreview = async () => {
    if (!activeAppId || isLoadingPreview) return;
    const appId = activeAppId;
    const req = ++previewReqRef.current;
    // Open the shell on the click: resolving is a poll loop of up to 40s.
    setPreviewOpen(true);
    setPreviewModalUrl(null);
    setPreviewError(null);
    setIsLoadingPreview(true);
    try {
      let url = null;
      for (let attempt = 0; attempt < 20; attempt++) {
        const res = await platform.getPreviewUrl(appId);
        if (previewReqRef.current !== req) return;
        let raw = res?.preview_url || res?.url || null;
        if (raw) {
          // API returns the host without a scheme — ensure it's a full URL
          if (!raw.startsWith("http")) raw = `https://${raw}`;
          url = raw;
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
        if (previewReqRef.current !== req) return;
      }
      if (url) setPreviewModalUrl(url);
      else setPreviewError("The preview isn't up yet — the app may still be building.");
    } catch (err) {
      if (previewReqRef.current !== req) return;
      setPreviewError(err.message);
    } finally {
      if (previewReqRef.current === req) setIsLoadingPreview(false);
    }
  };
  openPreviewRef.current = openPreview;


  // Newest assistant message drives the running-shimmer; widget interactivity is
  // gated on tool-call status, not position.
  const lastBuildAssistantIndex = buildMessages.reduce(
    (acc, m, i) => (m.role === "assistant" ? i : acc),
    -1,
  );
  // Turn paused on a user-input widget — lock the build composer so a typed
  // message can't race into the paused turn.
  const awaitingInput = buildMessages.some((m) =>
    (m.tool_calls || []).some((tc) => tc.status === "waiting_for_user_input"),
  );

  const userMessageCount = buildMessages.filter((m) => m.role === "user").length;
  const lastAssistantId =
    lastBuildAssistantIndex >= 0 ? (buildMessages[lastBuildAssistantIndex]?.id ?? null) : null;

  /**
   * Derived, not remembered: it used to open on a `processing -> settled` edge, so
   * only the client that watched the build finish ever saw it.
   */
  // `status.state` reads "ready" in the gap between sending and the builder
  // picking it up, which popped the card on the previous turn's result. The
  // conversation's shape is reliable: assistant last, no tool call in flight.
  const lastVisible = buildMessages.length ? buildMessages[buildMessages.length - 1] : null;
  // Only this turn: a tool left `running` by an abandoned turn would otherwise hide
  // the card for good, and it is the only way to publish.
  const lastUserIndex = buildMessages.reduce((acc, m, i) => (m.role === "user" ? i : acc), -1);
  const hasToolInFlight = buildMessages
    .slice(lastUserIndex + 1)
    .some((m) => (m.tool_calls || []).some((tc) => TOOL_PENDING.includes(tc.status)));

  const appReady =
    Boolean(activeApp) &&
    !isBuilding &&
    !awaitingInput &&
    !hasToolInFlight &&
    !pendingSend &&
    lastVisible?.role === "assistant" &&
    lastAssistantId !== null &&
    dismissedReadyFor !== lastAssistantId;

  // Retire the held text once the conversation carries it. Two tests, because an
  // exact match alone strands text the server normalised.
  useEffect(() => {
    if (!pendingSend) return;
    const landed =
      userMessageCount > pendingSend.userCount ||
      buildMessages.some(
        (m) =>
          m.role === "user" &&
          (typeof m.content === "string" ? m.content : platform.messageText?.(m.content) || "") ===
            pendingSend.text,
      );
    if (!landed) return;
    setBuildInput((current) => (current === pendingSend.text ? "" : current));
    setPendingSend(null);
  }, [pendingSend, buildMessages, userMessageCount]);

  // Never stay locked on an echo that never arrives.
  useEffect(() => {
    if (!pendingSend) return;
    const t = setTimeout(() => setPendingSend(null), 30000);
    return () => clearTimeout(t);
  }, [pendingSend]);

  // So the card cannot offer a pin that already exists.
  useEffect(() => {
    if (!activeAppId) {
      setAlreadyPinned(false);
      return;
    }
    let cancelled = false;
    WidgetEntity.filter({ app_id: activeAppId })
      .then((rows) => {
        if (!cancelled) setAlreadyPinned(Array.isArray(rows) && rows.length > 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeAppId, savedAs]);

  // The builder reports no completion, so "finished" is an edge in the poll.
  const buildingAppIdRef = useRef(null);
  useEffect(() => {
    if (!activeAppId) {
      buildingAppIdRef.current = null;
      return;
    }
    if (isBuilding) {
      buildingAppIdRef.current = activeAppId;
      return;
    }
    // Keep the ref while paused on a widget: that later completion is the one.
    if (buildingAppIdRef.current !== activeAppId || awaitingInput) return;
    buildingAppIdRef.current = null;
    setSavedAs(null);
  }, [activeAppId, isBuilding, awaitingInput]);

  /**
   * A finished build refreshes the preview only. Widgets and My Tools show the
   * deployed build, which a build does not change — deploying announces instead.
   * The preview's url carries a short-lived token, so an open panel re-resolves.
   */
  const seenCommitRef = useRef({ appId: null, commit: null });
  useEffect(() => {
    if (!activeAppId || isBuilding || !currentCommit) return;
    const seen = seenCommitRef.current;
    if (seen.appId !== activeAppId) {
      // First sighting of this app: record it, never act on arrival.
      seenCommitRef.current = { appId: activeAppId, commit: currentCommit };
      return;
    }
    if (seen.commit === currentCommit) return;
    seenCommitRef.current = { appId: activeAppId, commit: currentCommit };
    if (previewOpen) openPreviewRef.current?.();
  }, [activeAppId, currentCommit, isBuilding, previewOpen]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — mobile only */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-foreground/10 md:hidden"
            onClick={onClose}
          />

          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-[380px] max-w-[95vw] bg-background border-l border-border flex flex-col shadow-2xl md:shadow-none"
          >
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-shrink-0">
              {buildView === "chat" && (
                <button
                  onClick={backToList}
                  aria-label="Back to your tools"
                  className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                {buildView === "chat" && activeApp ? (
                  <AppNameField app={activeApp} onRenamed={handleRenamed} />
                ) : (
                  <p className="text-sm font-medium text-foreground truncate">Build an app</p>
                )}
                {buildView === "chat" && activeApp && (
                  <div className="flex items-center gap-2 ml-1">
                    {isBuilding ? (
                      <span className="text-xs text-accent flex items-center gap-1">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" /> Building
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {buildView === "chat" && activeApp && (
                  <>
                    <button
                      onClick={openPreview}
                      disabled={isLoadingPreview}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded hover:bg-secondary transition-colors disabled:opacity-50"
                    >
                      {isLoadingPreview ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                      {isLoadingPreview ? "Opening…" : "Preview"}
                    </button>
                  </>
                )}
                {buildView === "list" && (
                  <Link
                    href="/market"
                    onClick={onClose}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded hover:bg-secondary transition-colors hidden"
                  >
                    <LayoutGrid className="w-3.5 h-3.5" /> Market
                  </Link>
                )}
                <button
                  onClick={onClose}
                  className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {error && (
              <div className="mx-4 mt-3 flex gap-2 items-start bg-destructive/10 border border-destructive/20 rounded px-3 py-2.5 flex-shrink-0">
                <AlertTriangle className="w-3.5 h-3.5 text-destructive mt-0.5 flex-shrink-0" />
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}

            {/* BUILD MODE — checking / connecting auth */}
            {(linked === null || linked === false) && (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* BUILD MODE — app list */}
            {linked === true && buildView === "list" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <button
                    onClick={startNewApp}
                    className="w-full flex items-center gap-2 justify-center text-sm font-medium bg-primary text-primary-foreground px-4 py-2.5 rounded hover:bg-primary/90 transition-colors"
                  >
                    <Plus className="w-4 h-4" /> create new
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {isLoadingApps ? (
                    <div className="flex justify-center pt-10">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : apps.length === 0 ? (
                    <div className="px-4 py-10 text-center">
                      <p className="text-sm text-muted-foreground">
                        No apps yet. Hit "New app" to build one.
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {apps.map((app) => (
                        <button
                          key={app.id}
                          onClick={() => selectApp(app)}
                          className="w-full text-left px-4 py-3.5 hover:bg-secondary/50 transition-colors flex items-center gap-3"
                        >
                          <div className="w-9 h-9 rounded bg-muted flex-shrink-0 overflow-hidden flex items-center justify-center">
                            {app.preview_screenshot_url || app.logo_url ? (
                              <img
                                src={app.preview_screenshot_url || app.logo_url}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="text-base font-display text-muted-foreground">
                                {(app.name || "?")[0].toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {app.name || "Untitled"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {app.status?.state === "processing" ? (
                                <span className="text-accent flex items-center gap-1">
                                  <Loader2 className="w-2.5 h-2.5 animate-spin inline" /> Building…
                                </span>
                              ) : (
                                new Date(app.updated_date).toLocaleDateString()
                              )}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* BUILD MODE — chat */}
            {linked === true && buildView === "chat" && (
              <>
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                  {!activeApp && buildMessages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-10">
                      <Hammer className="w-8 h-8 text-muted-foreground/40" />
                      <div>
                        <h3 className="font-display text-xl text-foreground mb-1">Build an app</h3>
                        <p className="text-muted-foreground text-xs max-w-xs">
                          Describe what you want and I'll create it.
                        </p>
                      </div>
                      <div className="flex flex-col gap-1.5 w-full mt-2">
                        {boardSuggestions.map((s) => (
                          <button
                            key={s}
                            onClick={() => setBuildInput(s)}
                            className="px-3 py-2 text-xs bg-card border border-border rounded text-muted-foreground hover:text-foreground hover:border-foreground/25 transition-colors text-left"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {buildMessages.map((msg, i) => (
                    <MessageBubble
                      key={msg.id || i}
                      message={msg}
                      appId={activeAppId}
                      isLastAssistant={i === lastBuildAssistantIndex}
                      onSubmitted={() => refresh(activeAppId).catch(() => {})}
                    />
                  ))}
                  {isBuilding && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground pl-8">
                      <Loader2 className="w-3 h-3 animate-spin" /> building…
                    </div>
                  )}
                  {appReady && (
                    <div className="pl-8">
                      <AppReadyWidget
                        appName={activeApp?.name}
                        onPreview={openPreview}
                        isLoadingPreview={isLoadingPreview}
                        onSaveToMyTools={saveToMyTools}
                        isSaving={pendingSave === "my-tools"}
                        isSaved={savedToMyTools}
                        offerMarket={cameFromMarket}
                        onAddToMarket={addToMarket}
                        isAddingToMarket={pendingSave === "market"}
                        isAddedToMarket={listedInMarket}
                        offerMyWidgets={cameFromWidgetPicker}
                        onAddToMyWidgets={addToMyWidgets}
                        isAddingToMyWidgets={pendingSave === "widgets"}
                        isAddedToMyWidgets={addedToMyWidgets || alreadyPinned}
                        myToolsHref={activeAppId ? `/apps?app=${activeAppId}` : null}
                        // Close the builder on the way: the point of following the
                        // link is to look at the app, and the panel covers it.
                        onNavigate={onClose}
                        onKeepEditing={() => {
                          // Dismissed for this turn only: the next finished turn
                          // produces a new assistant message, so a fresh card.
                          setDismissedReadyFor(lastAssistantId);
                          setSavedAs(null);
                        }}
                      />
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
                <div className="border-t border-border bg-card p-3 flex-shrink-0">
                  <div className="flex gap-2 items-end">
                    <Textarea
                      value={buildInput}
                      onChange={(e) => setBuildInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          submitBuild();
                        }
                      }}
                      disabled={awaitingInput || Boolean(pendingSend)}
                      placeholder={
                        awaitingInput
                          ? "Answer the prompt above to continue…"
                          : activeApp
                            ? "Describe a change…"
                            : "Describe the app you want…"
                      }
                      className="flex-1 min-h-[38px] max-h-28 resize-none text-sm disabled:opacity-60"
                      rows={1}
                    />

                    <button
                      onClick={submitBuild}
                      disabled={!buildInput.trim() || isSending || awaitingInput}
                      className="flex-shrink-0 w-9 h-9 bg-primary text-primary-foreground rounded flex items-center justify-center hover:bg-primary/90 transition-colors disabled:opacity-40"
                    >
                      {isSending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin pointer-events-none" />
                      ) : (
                        <Send className="w-3.5 h-3.5 pointer-events-none" />
                      )}
                    </button>
                  </div>
                </div>
              </>
            )}
          </motion.div>

          <AppPreviewModal
            open={previewOpen}
            title={activeApp?.name}
            url={previewModalUrl}
            appId={activeAppId}
            error={previewError}
            onClose={closePreview}
            onRetry={openPreview}
            stageHint="The first preview takes a few seconds while the app boots."
          />

          {marketApp && (
            <PublishDialog
              app={marketApp}
              onClose={() => setMarketApp(null)}
              onDone={() => {
                setMarketApp(null);
                setListedInMarket(true);
              }}
            />
          )}
        </>
      )}
    </AnimatePresence>
  );
}
