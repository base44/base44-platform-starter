/**
 * The App Builder — the whole Base44 integration, as a user sees it.
 *
 * A docked panel with two views: a list of the apps this user has built, and a chat
 * that drives one build. Everything it does goes through `src/lib/base44Platform.ts`
 * to the server proxy; nothing here holds a Base44 credential.
 *
 * The flow:
 *
 *   1. `useAuth().builderAvailable` gates the UI: is the Base44 bridge configured
 *      on this deployment? One integration account builds every app, server-side,
 *      so there is nothing per-user to connect — unavailable means "not here".
 *   2. The chat runs on `useChat` from `@base44/platform/react`, over `chatBackend`
 *      below: four calls, each through the proxy. It follows the app live over a
 *      socket session the proxy opens (`openLiveSession`), so the conversation,
 *      the turn's status and its steps arrive as they happen, with no polling.
 *   3. First submit → `chat.create()`, which calls `platform.createApp()` with the
 *      prompt, a locally-derived name, and `buildCustomInstructions()` — the text
 *      Base44's builder applies on every turn. Later submits → `chat.send()`.
 *   4. A builder turn can *pause* on a question — approval, clarifying questions,
 *      secrets. The hook binds each to its tool call, the widgets in
 *      `src/components/builder/` render it, and its own actions resume the turn.
 *   5. The app's own fields (commit hashes, deploy state) come from `getApp`,
 *      fetched again whenever the chat's status changes.
 *   6. Preview boots a sandbox (`getPreviewUrl`, up to ~40s) into an iframe; "Save
 *      to My Tools" deploys and records local ownership.
 *
 * Because every `getApp` reply is awaited against a moving target, `shownAppIdRef`
 * records which app the chat is *meant* to be showing and every commit checks it
 * first — otherwise a reply that lands after the user navigates away re-hydrates
 * the app it was fetched for.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import * as platform from "@/lib/base44Platform";
import { Board } from "@/lib/entityClient";
import { useAuth } from "@/lib/AuthContext";
import { suggestAppName } from "@/lib/appName";
import { buildCustomInstructions } from "@/lib/builderInstructions";
import { addAppToMyWidgets } from "@/lib/myWidgets";
import { announceAppRebuilt } from "@/lib/appRefresh";
import { useMarketChanges } from "@/lib/marketEvents";
import { marketPublishState } from "@/lib/marketPublishState";
import { Widget as WidgetEntity } from "@/lib/entityClient";
import AppPreviewModal from "@/components/AppPreviewModal";
import { Textarea } from "@/components/ui/textarea";
import ReactMarkdown from "react-markdown";
import { useChat } from "@base44/platform/react";
import {
  Send,
  Plus,
  Loader2,
  AlertTriangle,
  Bot,
  User,
  X,
  ChevronLeft,
  Sparkles,
  Hammer,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import QuestionWidget from "@/components/builder/QuestionWidget";
import ToolRow from "@/components/builder/ToolRow";
import AppReadyWidget from "@/components/builder/widgets/AppReadyWidget";
import PublishDialog from "@/components/market/PublishDialog";
import AppNameField from "@/components/AppNameField";

/**
 * The four calls `useChat` makes, each through the allow-listed proxy. The first
 * prompt names the app and carries the builder instructions; a tool-call answer
 * travels under a request id stable per tool call (see `submitRequestId`).
 */
const chatBackend = {
  createApp: (prompt) =>
    platform.createApp({
      prompt,
      name: suggestAppName(prompt),
      customInstructions: buildCustomInstructions(),
    }),
  openLiveSession: (appId) => platform.openLiveSession(appId),
  sendMessage: async (appId, content) => {
    await platform.sendMessage(appId, content);
  },
  submitToolCallInput: async (appId, { toolCallId, messageId, approve, extraUserInput }) => {
    await platform.submitToolCallInput(appId, toolCallId, approve, extraUserInput, { messageId });
  },
};

/** A step with an open question renders its widget; any other step is a line of activity. */
function StepRow({ step }) {
  if (step.question) return <QuestionWidget step={step} question={step.question} />;
  // What the user answered stays under the step after the question closes.
  const answered = step.answered?.map((a, i) => (
    <p key={i}>
      {a.question}: {[...a.labels, a.text].filter(Boolean).join(", ")}
    </p>
  ));
  return (
    <ToolRow
      status={step.status}
      name={step.label}
      summary={answered?.length ? answered : null}
      details={addsToLabel(step) ? <StepDetails step={step} /> : null}
    />
  );
}

// A label like "read_file" or "write_file src/lib/sunny.js" already says everything the details would.
const addsToLabel = (step) =>
  !step.label.includes(step.tool) || step.files.some((file) => !step.label.includes(file));

/** What `useChat` keeps of a tool call: the tool, and the files it touched. */
function StepDetails({ step }) {
  return (
    <div className="space-y-1">
      <p className="font-mono text-foreground">{step.tool}</p>
      {step.files.length > 0 && (
        <ul className="font-mono space-y-0.5">
          {step.files.map((file) => <li key={file} className="break-all">{file}</li>)}
        </ul>
      )}
    </div>
  );
}

function MessageBubble({ item }) {
  const isUser = item.role === "user";
  if (!item.text && item.steps.length === 0) return null;

  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"} ${item.pending ? "opacity-60" : ""}`}>
      <div
        className={`flex-shrink-0 w-6 h-6 rounded flex items-center justify-center ${isUser ? "bg-primary text-primary-foreground" : "bg-secondary border border-border text-muted-foreground"}`}
      >
        {isUser ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
      </div>
      <div className={`max-w-[82%] flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
        {item.text && (
          <div
            className={`px-3 py-2 rounded text-xs leading-relaxed ${isUser ? "bg-primary text-primary-foreground" : "bg-card border border-border text-foreground"}`}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap">{item.text}</p>
            ) : (
              <ReactMarkdown className="prose prose-xs max-w-none prose-p:text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-pre:bg-secondary prose-code:text-foreground">
                {item.text}
              </ReactMarkdown>
            )}
          </div>
        )}
        {item.steps.map((step) => (
          <StepRow key={step.id} step={step} />
        ))}
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
  embedded = false,
  workspacePage = false,
  mobileExpanded = false,
  onActiveAppChange,
  onAppCreated,
  onGoHome,
  onCreateNewApp,
  onBackToList,
  marketListing,
}) {
  // App build state
  const [apps, setApps] = useState([]);
  const [isLoadingApps, setIsLoadingApps] = useState(false);
  const [activeApp, setActiveApp] = useState(null);
  const [buildInput, setBuildInput] = useState("");
  const [buildView, setBuildView] = useState("list"); // "list" | "chat"

  const { builderAvailable, recheck } = useAuth();
  const [rechecking, setRechecking] = useState(false);
  // Mirror the context value: a 501 mid-session flips it off locally too.
  const [builderReady, setBuilderReady] = useState(null);

  const [error, setError] = useState(null);
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
  const conversationRef = useRef(null);
  // Follow new steps only while the user is at the bottom: a running turn updates
  // `chat.items` on every live event, and must not pull a reader back down.
  const followRef = useRef(true);
  const composerInputRef = useRef(null);

  // The app the chat is *intended* to be showing. Every awaited refresh checks it
  // before committing, so a reply that lands after the user moved on is dropped
  // rather than re-hydrating the app it was fetched for. Without this the idle
  // poll can restore `activeApp` a moment after "create new" cleared it, and the
  // next submit edits the previous app instead of creating one.
  const shownAppIdRef = useRef(null);
  // Same idea for the preview poll loop, which runs for up to 40s.
  const previewReqRef = useRef(0);
  // Which composer a create came from. Leaving the composer bumps it, so an app
  // created after the user moved on is listed but not opened.
  const composerReqRef = useRef(0);
  const createReqRef = useRef(null);

  const resetComposer = useCallback(() => {
    composerReqRef.current++;
    setBuildInput("");
  }, []);

  const activeAppId = activeApp?.id || null;

  const handleAppCreated = (app) => {
    setApps((prev) => [app, ...prev]);
    if (createReqRef.current !== composerReqRef.current) return;
    shownAppIdRef.current = app.id;
    setActiveApp(app);
    onAppCreated?.(app);
  };
  const chat = useChat({ appId: activeAppId, backend: chatBackend, onAppCreated: handleAppCreated });
  const isBuilding = chat.status === "building";
  // Turn paused on a question: lock the composer so a typed prompt can't race
  // into the paused turn.
  const awaitingInput = chat.status === "waiting";
  const isSending = chat.status === "submitted";
  // A prompt goes only when the builder can take one now. After a failed build,
  // a prompt can ask for the fix.
  const canSend = chat.status === "ready" || chat.status === "error";

  useEffect(() => {
    onActiveAppChange?.(activeApp);
  }, [activeApp, onActiveAppChange]);

  // Where the builder was opened from is already a statement of intent, so it picks
  // the finished app's primary destination rather than asking. From the Add-widget
  // picker: pin it. From the market: list it. Everything lands in My Tools regardless.
  const cameFromWidgetPicker = origin === "home-widget";
  const cameFromMarket = origin === "market";
  const [marketApp, setMarketApp] = useState(null);
  const [ownListings, setOwnListings] = useState({});
  const refreshMarketListings = useCallback(() => {
    fetch("/api/marketplace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "mine" }),
    }).then((response) => response.ok ? response.json() : { listings: [] })
      .then(({ listings = [] }) => setOwnListings(Object.fromEntries(listings.map((item) => [item.app_id, item]))))
      .catch(() => {});
  }, []);
  useEffect(() => { if (open && !embedded) refreshMarketListings(); }, [open, embedded, refreshMarketListings]);
  useMarketChanges(refreshMarketListings);
  const activeMarketListing = embedded ? marketListing : ownListings[activeAppId];
  const marketState = activeApp ? marketPublishState(activeApp, activeMarketListing, editedSinceDeploy) : "unlisted";

  useEffect(() => {
    if (followRef.current) messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.items]);
  // Scrolling up stops following; reaching the bottom again resumes it. The scroll
  // above only moves down, so an upward move is always the user's.
  const lastScrollTopRef = useRef(0);
  const onConversationScroll = () => {
    const el = conversationRef.current;
    if (!el) return;
    if (el.scrollTop < lastScrollTopRef.current) followRef.current = false;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) followRef.current = true;
    lastScrollTopRef.current = el.scrollTop;
  };
  useEffect(() => {
    if (embedded && open && requestId > 0 && initialAppId == null && buildView === "chat" && builderReady === true) {
      composerInputRef.current?.focus();
    }
  }, [embedded, open, requestId, initialAppId, buildView, builderReady]);

  // Open a specific app in the build chat when initialAppId is provided
  useEffect(() => {
    if (open && initialAppId && builderReady === true) {
      shownAppIdRef.current = initialAppId;
      setBuildView("chat");
      setActiveApp(null);
      resetComposer();
      setError(null);
      setDismissedReadyFor(null);
      setSavedAs(null);
      platform
        .getApp(initialAppId)
        .then((app) => {
          if (shownAppIdRef.current === initialAppId) setActiveApp(app);
        })
        .catch((err) => setError(err.message));
    }
    // Keyed on the request, so re-opening the same app reloads it.
  }, [open, requestId, initialAppId, builderReady, resetComposer]);

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

  // Sync availability from context
  useEffect(() => {
    if (builderAvailable === null) return;
    setBuilderReady(builderAvailable);
  }, [builderAvailable]);

  // Load apps whenever we enter build mode and the builder is available
  useEffect(() => {
    if (builderReady !== true) return;
    setIsLoadingApps(true);
    platform
      .listApps({ limit: 25 })
      .then((list) => setApps(list))
      .catch(() => {})
      .finally(() => setIsLoadingApps(false));
  }, [builderReady]);

  // The app's own fields, which the chat doesn't carry.
  const refresh = useCallback(async (appId) => {
    const app = await platform.getApp(appId);
    // The list row is always safe to freshen — it is keyed by id either way.
    setApps((prev) => prev.map((a) => (a.id === app.id ? { ...a, ...app } : a)));
    // The chat is not: if the user has since gone back or started a new app,
    // committing here would put the old app back on screen.
    if (shownAppIdRef.current !== appId) return;
    setActiveApp(app);
  }, []);

  // A turn that starts, pauses or ends changes the app (status, commit hash), so
  // fetch it again on every change of the chat's status.
  useEffect(() => {
    if (!activeAppId) return;
    refresh(activeAppId).catch(() => {});
  }, [activeAppId, chat.status, refresh]);

  // A 501 mid-session flips the builder off here too.
  useEffect(() => {
    if (platform.isBuilderUnavailable(chat.error?.cause)) setBuilderReady(false);
  }, [chat.error]);

  // The one way to get to an empty composer. Clearing `shownAppIdRef` is the part
  // that matters: it invalidates any refresh already in flight for the app we are
  // leaving, so the next submit is guaranteed to hit `createApp`.
  const startNewApp = useCallback(() => {
    shownAppIdRef.current = null;
    setActiveApp(null);
    resetComposer();
    setError(null);
    setDismissedReadyFor(null);
    setSavedAs(null);
    setBuildView("chat");
  }, [resetComposer]);

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
      if (platform.isBuilderUnavailable(err)) setBuilderReady(false);
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
      if (platform.isBuilderUnavailable(err)) setBuilderReady(false);
      setError(err.message);
    } finally {
      setPendingSave(null);
    }
  };

  const addToMarket = () => {
    if (!activeAppId || isSavingToMyTools || isBuilding) return;
    setMarketApp(activeApp);
  };

  const handleRenamed = useCallback((id, name) => {
    setActiveApp((prev) => (prev?.id === id ? { ...prev, name } : prev));
    setApps((prev) => prev.map((a) => (a.id === id ? { ...a, name } : a)));
  }, []);

  // App build submit
  const submitBuild = () => {
    const content = buildInput.trim();
    // Answer the open question before sending a free-form prompt, or it races
    // into the paused turn.
    if (!content || !canSend) return;
    // Carrying on, so the card steps aside.
    if (appReady) setDismissedReadyFor(lastAssistantId);
    setSavedAs(null);
    setEditedAppId(activeApp?.id ?? null);
    setError(null);
    // The prompt shows at once as a pending item, so the composer clears now.
    setBuildInput("");
    followRef.current = true;
    if (activeApp) {
      chat.send(content);
      return;
    }
    createReqRef.current = composerReqRef.current;
    chat.create(content);
  };

  const selectApp = async (app) => {
    shownAppIdRef.current = app.id;
    setActiveApp(app);
    resetComposer();
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
    resetComposer();
    setBuildView("list");
    setError(null);
    setDismissedReadyFor(null);
    setSavedAs(null);
    onBackToList?.();
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


  const items = chat.items;
  const lastAssistantId = items.findLast((item) => item.role === "assistant")?.id ?? null;

  /**
   * Derived, not remembered: it used to open on a `processing -> settled` edge, so
   * only the client that watched the build finish ever saw it.
   */
  // The conversation's shape: assistant last, nothing pending, no step in flight.
  const lastItem = items.length ? items[items.length - 1] : null;
  // Only this turn: a step left `running` by an abandoned turn would otherwise
  // hide the card for good, and it is the only way to publish.
  const lastUserIndex = items.findLastIndex((item) => item.role === "user");
  const hasStepInFlight = items
    .slice(lastUserIndex + 1)
    .some((item) => item.steps.some((step) => step.status === "running" || step.status === "waiting"));

  const appReady =
    Boolean(activeApp) &&
    chat.status === "ready" &&
    !hasStepInFlight &&
    lastItem?.role === "assistant" &&
    !lastItem.pending &&
    lastAssistantId !== null &&
    dismissedReadyFor !== lastAssistantId;

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

  // "Finished" is an edge in the chat's status.
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
            className={`fixed inset-0 z-40 bg-foreground/10 md:hidden ${embedded ? `sunny-apps-backdrop ${mobileExpanded ? "is-open" : ""}` : ""}`}
            onClick={onClose}
          />

          <motion.div
            initial={embedded ? false : { x: "100%" }}
            animate={embedded ? undefined : { x: 0 }}
            exit={embedded ? undefined : { x: "100%" }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className={embedded ? `sunny-builder-panel sunny-apps-embedded-builder ${mobileExpanded ? "is-open" : ""}` : "sunny-builder-panel sunny-builder-docked"}
          >
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-shrink-0">
              {buildView === "chat" && !embedded && (
                <button
                  onClick={backToList}
                  aria-label="Choose an app"
                  className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
              <div className="flex-1 min-w-0 flex items-center gap-2">
                {activeApp && buildView === "chat" ? <span className="sunny-apps-edit-badge">Editing</span> : <Sparkles className="w-3.5 h-3.5 text-accent flex-shrink-0" />}
                {buildView === "chat" && activeApp
                  ? <AppNameField app={activeApp} onRenamed={handleRenamed} className="min-w-0" />
                  : <p className="text-sm font-medium text-foreground truncate">{buildView === "list" ? "Your apps" : "Build an app"}</p>}
                {isBuilding && buildView === "chat" && <Loader2 className="w-3 h-3 animate-spin text-accent flex-shrink-0" aria-label="Building" />}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => { startNewApp(); onCreateNewApp?.(); }}
                  className="sunny-apps-new-app"
                >
                  <Plus className="w-3.5 h-3.5" /> Create new app
                </button>
                {(!embedded || mobileExpanded) && <button
                  onClick={onClose}
                  className={`p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors ${embedded ? "sunny-apps-mobile-close" : ""}`}
                >
                  <X className="w-4 h-4" />
                </button>}
              </div>
            </div>

            {(error || chat.error) && (
              <div className="mx-4 mt-3 flex gap-2 items-start bg-destructive/10 border border-destructive/20 rounded px-3 py-2.5 flex-shrink-0">
                <AlertTriangle className="w-3.5 h-3.5 text-destructive mt-0.5 flex-shrink-0" />
                <p className="text-xs text-destructive flex-1">{error || chat.error.message}</p>
                {!error && (
                  <button onClick={chat.clearError} aria-label="Dismiss" className="text-destructive/70 hover:text-destructive">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* BUILD MODE — checking whether the builder is available here */}
            {builderReady === null && (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {builderReady === false && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-sm text-muted-foreground">App building isn't configured on this deployment.</p>
                <button
                  disabled={rechecking}
                  onClick={async () => {
                    setRechecking(true);
                    try { await recheck(); } finally { setRechecking(false); }
                  }}
                  className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
                >
                  {rechecking ? "Checking…" : "Check again"}
                </button>
              </div>
            )}

            {/* BUILD MODE — app list */}
            {builderReady === true && buildView === "list" && (
              <div className="sunny-builder-picker flex-1 flex flex-col overflow-hidden">
                <div className="sunny-builder-picker-intro">
                  <strong>Continue with an app</strong>
                  <span>Choose an app to edit, or create a new one.</span>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {isLoadingApps ? (
                    <div className="flex justify-center pt-10">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : apps.length === 0 ? (
                    <div className="px-4 py-10 text-center">
                      <p className="text-sm text-muted-foreground">
                        No apps yet. Create a new app to get started.
                      </p>
                    </div>
                  ) : (
                    <div className="sunny-builder-picker-list">
                      {apps.map((app) => (
                        <button
                          key={app.id}
                          onClick={() => selectApp(app)}
                          className="sunny-builder-picker-item w-full text-left flex items-center gap-3"
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
            {builderReady === true && buildView === "chat" && (
              <>
                <div
                  ref={conversationRef}
                  onScroll={onConversationScroll}
                  className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
                  role="region"
                  aria-label="Conversation"
                >
                  {!activeApp && items.length === 0 && (
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
                  {activeApp && items.length === 0 && chat.connection === "connecting" && (
                    <div className="flex justify-center pt-10">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-label="Loading the conversation" />
                    </div>
                  )}
                  {items.map((item) => (
                    <MessageBubble key={item.id} item={item} />
                  ))}
                  {isBuilding && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground pl-8">
                      <Loader2 className="w-3 h-3 animate-spin" /> building…
                    </div>
                  )}
                  {appReady && (
                    <div className="sunny-builder-ready">
                      <AppReadyWidget
                        appName={activeApp?.name}
                        onPreview={openPreview}
                        hidePreview={embedded || workspacePage}
                        isLoadingPreview={isLoadingPreview}
                        onSaveToMyTools={saveToMyTools}
                        isSaving={pendingSave === "my-tools"}
                        isSaved={savedToMyTools}
                        offerMarket={embedded || workspacePage || cameFromMarket}
                        onAddToMarket={addToMarket}
                        isAddingToMarket={pendingSave === "market"}
                        isAddedToMarket={marketState === "live"}
                        offerMyWidgets={!embedded && !workspacePage && cameFromWidgetPicker}
                        onAddToMyWidgets={addToMyWidgets}
                        isAddingToMyWidgets={pendingSave === "widgets"}
                        isAddedToMyWidgets={addedToMyWidgets || alreadyPinned}
                        myToolsHref={activeAppId ? `/apps?app=${activeAppId}` : null}
                        onAllApps={embedded || workspacePage ? onGoHome : undefined}
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
                      ref={composerInputRef}
                      value={buildInput}
                      onChange={(e) => setBuildInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          submitBuild();
                        }
                      }}
                      disabled={!canSend}
                      aria-label={activeApp ? "What should change?" : "What would you like to build?"}
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
                      disabled={!buildInput.trim() || !canSend}
                      aria-label={activeApp ? "Send prompt" : "Create app"}
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
            target="live_preview"
            error={previewError}
            onClose={closePreview}
            onRetry={openPreview}
            stageHint="The first preview takes a few seconds while the app boots."
          />

          {marketApp && (
            <PublishDialog
              app={marketApp}
              onClose={() => setMarketApp(null)}
              onDone={(fresh) => {
                setMarketApp(null);
                setEditedAppId(null);
                setActiveApp((current) => current?.id === fresh.id ? { ...current, ...fresh } : current);
                refreshMarketListings();
                void refresh(fresh.id);
              }}
            />
          )}
        </>
      )}
    </AnimatePresence>
  );
}
