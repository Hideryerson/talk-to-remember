"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { getToken } from "@/lib/auth";
import { apiUrl, getBackendWsUrl } from "@/lib/api";
import { Camera, Check, ChevronLeft, RotateCcw, Sparkles, X } from "lucide-react";
import {
  LiveSession,
  DEFAULT_SYSTEM_INSTRUCTION,
  type LiveAppEvent,
  type LiveSessionCallbacks,
  type LiveTranscriptEntry,
} from "@/lib/liveSession";
import ControlBar from "./ControlBar";
import FloatingTranscript from "./FloatingTranscript";
import VersionGallery from "./VersionGallery";
import type { ChatMessage, ImageVersion, UserProfile } from "@/lib/types";

interface ImmersiveChatProps {
  conversationId: string | null;
  profile: UserProfile;
  onBack: () => void;
}

type SessionState = "idle" | "connecting" | "listening" | "speaking" | "editing" | "paused";

const DEBUG = true;
function log(...args: any[]) {
  if (DEBUG) console.log("[ImmersiveChat]", ...args);
}

export default function ImmersiveChat({
  conversationId,
  profile,
  onBack,
}: ImmersiveChatProps) {
  // State
  const [convoId, setConvoId] = useState<string | null>(conversationId);
  const [image, setImage] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState("image/jpeg");
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [imageVersions, setImageVersions] = useState<ImageVersion[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [transcriptEntries, setTranscriptEntries] = useState<LiveTranscriptEntry[]>([]);
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [showTranscript, setShowTranscript] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [currentlySpeaking, setCurrentlySpeaking] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showWelcomeBack, setShowWelcomeBack] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const [isNewUpload, setIsNewUpload] = useState(false);
  const [hasStartedSession, setHasStartedSession] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [awaitingFirstAssistantTurn, setAwaitingFirstAssistantTurn] = useState(false);
  const [listeningLevel, setListeningLevel] = useState(0);
  const [pendingAssistantTranscript, setPendingAssistantTranscript] = useState("");
  const [isPaused, setIsPaused] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingEditPrompt, setPendingEditPrompt] = useState<string | null>(null);
  const [showEditConfirm, setShowEditConfirm] = useState(false);
  const [queuedEditConfirm, setQueuedEditConfirm] = useState(false);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const imageVersionsRef = useRef<ImageVersion[]>([]);
  const convoIdRef = useRef<string | null>(convoId);
  const liveSessionRef = useRef<LiveSession | null>(null);
  const currentImageIndexRef = useRef(0);
  const isEditingRef = useRef(false);
  const imageMimeTypeRef = useRef(imageMimeType);
  const awaitingFirstAssistantTurnRef = useRef(false);
  const assistantAudioInCurrentTurnRef = useRef(false);
  const pendingAssistantTranscriptRef = useRef("");
  const pendingUserTranscriptRef = useRef("");
  const userTranscriptCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFinalUserTranscriptRef = useRef("");
  const isPausedRef = useRef(false);
  const pendingEditPromptRef = useRef<string | null>(null);

  // Keep refs in sync
  useEffect(() => {
    messagesRef.current = messages;
    imageVersionsRef.current = imageVersions;
    convoIdRef.current = convoId;
    currentImageIndexRef.current = currentImageIndex;
    isEditingRef.current = isEditing;
    imageMimeTypeRef.current = imageMimeType;
    awaitingFirstAssistantTurnRef.current = awaitingFirstAssistantTurn;
    pendingAssistantTranscriptRef.current = pendingAssistantTranscript;
    isPausedRef.current = isPaused;
    pendingEditPromptRef.current = pendingEditPrompt;
  }, [messages, imageVersions, convoId, currentImageIndex, isEditing, imageMimeType, awaitingFirstAssistantTurn, pendingAssistantTranscript, isPaused, pendingEditPrompt]);

  const appendTranscriptEntry = useCallback((entry: LiveTranscriptEntry) => {
    if (!entry.isFinal) return;
    const normalized = entry.text.replace(/\s+/g, " ").trim();
    if (!normalized) return;

    setTranscriptEntries((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === entry.role && last.text === normalized) {
        return prev;
      }
      return [...prev, { role: entry.role, text: normalized, isFinal: true }];
    });
  }, []);

  const clearUserTranscriptCommitTimer = () => {
    if (userTranscriptCommitTimerRef.current) {
      clearTimeout(userTranscriptCommitTimerRef.current);
      userTranscriptCommitTimerRef.current = null;
    }
  };

  const clearPendingEditConfirmation = useCallback((notifyBackend: boolean = false) => {
    setShowEditConfirm(false);
    setPendingEditPrompt(null);
    pendingEditPromptRef.current = null;
    if (notifyBackend) {
      liveSessionRef.current?.cancelEditConfirm();
    }
  }, []);

  // Decay mic level so listening waveform reflects real input and settles smoothly.
  useEffect(() => {
    if (sessionState !== "listening") {
      setListeningLevel(0);
      return;
    }
    const timer = window.setInterval(() => {
      setListeningLevel((prev) => (prev < 0.02 ? 0 : prev * 0.72));
    }, 90);
    return () => window.clearInterval(timer);
  }, [sessionState]);

  // Detect orientation changes
  useEffect(() => {
    const checkOrientation = () => {
      const isLand = window.matchMedia("(orientation: landscape)").matches;
      setIsLandscape(isLand);
    };

    checkOrientation();
    const mq = window.matchMedia("(orientation: landscape)");
    mq.addEventListener("change", checkOrientation);
    return () => mq.removeEventListener("change", checkOrientation);
  }, []);

  // Hydrate existing conversation
  useEffect(() => {
    if (conversationId) {
      hydrateConversation(conversationId);
    } else {
      setHydrated(true);
    }

    // Cleanup on unmount
    return () => {
      clearUserTranscriptCommitTimer();
      pendingUserTranscriptRef.current = "";
      clearPendingEditConfirmation();
      if (liveSessionRef.current) {
        liveSessionRef.current.disconnect();
      }
    };
  }, [clearPendingEditConfirmation, conversationId]);

  // Check if this is a continuation (only for existing conversations, not new uploads)
  useEffect(() => {
    if (hydrated && messages.length > 0 && image && sessionState === "idle" && !isNewUpload && !hasStartedSession) {
      setShowWelcomeBack(true);
    }
  }, [hydrated, messages.length, image, sessionState, isNewUpload, hasStartedSession]);

  // Start Live API session
  const startLiveSession = useCallback(async (imageDataUrl: string, mimeType: string, isContinuation: boolean = false) => {
    if (liveSessionRef.current) {
      liveSessionRef.current.disconnect();
      liveSessionRef.current = null;
    }

    let liveCredential: string | null = null;
    let liveTokenError: string | null = null;
    const proxyConfigured = Boolean(getBackendWsUrl());
    const requestLiveToken = async (): Promise<{ token: string | null; error: string | null }> => {
      try {
        const tokenRes = await fetch(apiUrl("/api/live-token"), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        });

        if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          return { token: tokenData.token || null, error: null };
        }

        const errorData = await tokenRes.json().catch(() => ({}));
        const errorText = errorData.error || `HTTP ${tokenRes.status}`;
        log("Live token fetch failed:", errorText);
        return { token: null, error: errorText };
      } catch (tokenErr) {
        const errorText =
          tokenErr instanceof Error ? tokenErr.message : "Unknown request error";
        log("Live token request error:", tokenErr);
        return { token: null, error: errorText };
      }
    };

    // Proxy mode: browser only talks to your server WebSocket, no client credential needed.
    if (proxyConfigured) {
      liveCredential = "__proxy__";
    } else {
      // Direct mode: use short-lived server-issued Live token.
      const tokenResult = await requestLiveToken();
      liveCredential = tokenResult.token;
      liveTokenError = tokenResult.error;
    }

    if (!liveCredential) {
      log("No Live credential available");
      setLiveError(
        liveTokenError
          ? `Failed to get Live token: ${liveTokenError}`
          : "Missing Gemini Live credential. Configure /api/live-token or NEXT_PUBLIC_WS_URL."
      );
      setAwaitingFirstAssistantTurn(false);
      awaitingFirstAssistantTurnRef.current = false;
      return;
    }

    // Build profile context
    const profileContext = profile
      ? `User name: ${profile.name}. Hobbies: ${profile.hobbies.join(", ")}. About: ${profile.selfIntro}. Past sessions: ${profile.conversationSummaries.slice(-3).join(" | ")}`
      : "";

    // Build conversation history for continuation
    const historyContext = isContinuation && messagesRef.current.length > 0
      ? `\n\nPrevious conversation context:\n${messagesRef.current.slice(-5).map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n")}`
      : "";

    const welcomeInstruction = isContinuation
      ? "\n\nThe user is returning to continue a previous conversation. Welcome them back warmly and briefly recap what you were discussing before asking how you can help further."
      : "";

    const systemInstruction = `${DEFAULT_SYSTEM_INSTRUCTION}

${profileContext ? `About this user: ${profileContext}` : ""}${historyContext}${welcomeInstruction}`;
    const firstTurnPrompt = isContinuation
      ? "Welcome the user back in one short sentence, briefly recap what you discussed, and ask one follow-up question to continue."
      : "Start by saying: 'Hi, thank you for sharing the photo with me.' Then mention one detail you notice and ask one short, gentle question.";

    const createSession = (credential: string, useProxy: boolean) => {
      const createdSession = new LiveSession(credential, {
        systemInstruction,
        voiceName: "Puck",
        useProxy,
      });
      liveSessionRef.current = createdSession;
      return createdSession;
    };

    setSessionState("connecting");
    setIsPaused(false);
    isPausedRef.current = false;
    setIsEditing(false);
    isEditingRef.current = false;
    clearPendingEditConfirmation();
    setShowWelcomeBack(false);
    setLiveError(null);
    setListeningLevel(0);
    setAwaitingFirstAssistantTurn(true);
    setPendingAssistantTranscript("");
    awaitingFirstAssistantTurnRef.current = true;
    assistantAudioInCurrentTurnRef.current = false;
    pendingAssistantTranscriptRef.current = "";
    clearUserTranscriptCommitTimer();
    pendingUserTranscriptRef.current = "";
    lastFinalUserTranscriptRef.current = "";

    const commitAssistantMessage = (text: string) => {
      const normalized = text.replace(/\s+/g, " ").trim();
      if (!normalized) return;
      const lastMsg = messagesRef.current[messagesRef.current.length - 1];
      if (lastMsg?.role === "model" && lastMsg.text.replace(/\s+/g, " ").trim() === normalized) {
        return;
      }
      const newMsg: ChatMessage = { role: "model", text: normalized };
      const updated = [...messagesRef.current, newMsg];
      setMessages(updated);
      messagesRef.current = updated;
      setCurrentlySpeaking(normalized);
      appendTranscriptEntry({ role: "ai", text: normalized, isFinal: true });
      saveConversation(updated);
    };

    const commitUserMessage = async (text: string) => {
      const normalized = text.replace(/\s+/g, " ").trim();
      if (!normalized) return;
      const lastMsg = messagesRef.current[messagesRef.current.length - 1];
      if (lastMsg?.role === "user" && lastMsg.text.replace(/\s+/g, " ").trim() === normalized) {
        return;
      }
      const newMsg: ChatMessage = { role: "user", text: normalized };
      const updated = [...messagesRef.current, newMsg];
      setMessages(updated);
      messagesRef.current = updated;
      appendTranscriptEntry({ role: "user", text: normalized, isFinal: true });
      saveConversation(updated);

      // Async intent extraction using Gemini 2.5 Pro
      try {
        const response = await fetch(apiUrl("/api/extract-edit-intent"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({ text: normalized }),
        });
        if (response.ok) {
          const result = await response.json();
          if (result.isEditRequest && result.editPrompt && result.editPrompt.trim()) {
            const finalInstruction = result.editPrompt.trim();
            setPendingEditPrompt(finalInstruction);
            pendingEditPromptRef.current = finalInstruction;

            // Queue the confirmation prompt to show after AI finishes speaking
            setQueuedEditConfirm(true);

            // To prevent stale closures and handle the case where the fetch completes 
            // *after* the AI has already finished speaking, we use a functional state update
            // to check the guaranteed current sessionState dynamically.
            setSessionState((currentState) => {
              if (!assistantAudioInCurrentTurnRef.current && currentState !== "speaking") {
                setShowEditConfirm(true);
                setQueuedEditConfirm(false);
              }
              return currentState;
            });
          }
        }
      } catch (err) {
        log("Intent extraction failed:", err);
      }
    };

    const mergeTranscriptChunk = (prev: string, chunk: string) => {
      if (!chunk) return prev;
      if (!prev) return chunk;

      if (chunk.startsWith(prev)) return chunk;
      if (prev.endsWith(chunk)) return prev;

      return prev + chunk;
    };

    const flushPendingUserTranscript = () => {
      clearUserTranscriptCommitTimer();
      const normalized = pendingUserTranscriptRef.current.trim();
      pendingUserTranscriptRef.current = "";
      if (!normalized) return;
      if (lastFinalUserTranscriptRef.current === normalized) return;
      lastFinalUserTranscriptRef.current = normalized;
      commitUserMessage(normalized);
    };

    const scheduleUserTranscriptFlush = (delayMs: number) => {
      clearUserTranscriptCommitTimer();
      userTranscriptCommitTimerRef.current = setTimeout(() => {
        flushPendingUserTranscript();
      }, delayMs);
    };

    const applyEditedImageVersion = (
      imageBase64: string,
      editedMimeType: string,
      editInstruction: string
    ) => {
      const newDataUrl = `data:${editedMimeType || imageMimeTypeRef.current};base64,${imageBase64}`;
      const nextVersion: ImageVersion = {
        dataUrl: newDataUrl,
        editPrompt: editInstruction,
        timestamp: Date.now(),
      };
      const updatedVersions = [...imageVersionsRef.current, nextVersion];
      setImageVersions(updatedVersions);
      imageVersionsRef.current = updatedVersions;
      setCurrentImageIndex(updatedVersions.length - 1);
      currentImageIndexRef.current = updatedVersions.length - 1;
      saveConversation(undefined, updatedVersions);
    };

    const sessionCallbacks: LiveSessionCallbacks = {
      onConnected: () => {
        log("Live session connected");
        setLiveError(null);
        setIsPaused(false);
        isPausedRef.current = false;
        setSessionState("connecting");

        const activeSession = liveSessionRef.current;
        if (!activeSession) return;

        // Send the image
        const base64 = imageDataUrl.split(",")[1];
        activeSession.sendImage(base64, mimeType, firstTurnPrompt);

        // Start audio input
        activeSession.startAudioInput().then((started) => {
          if (!started) {
            log("Audio input failed to start");
            setLiveError("Microphone failed to start. Check browser microphone permission.");
            setSessionState("idle");
            setAwaitingFirstAssistantTurn(false);
            setPendingAssistantTranscript("");
            clearUserTranscriptCommitTimer();
            pendingUserTranscriptRef.current = "";
            awaitingFirstAssistantTurnRef.current = false;
            pendingAssistantTranscriptRef.current = "";
          }
        });
      },
      onDisconnected: () => {
        log("Live session disconnected");
        clearUserTranscriptCommitTimer();
        clearPendingEditConfirmation();
        setIsEditing(false);
        isEditingRef.current = false;
        setListeningLevel(0);
        setCurrentlySpeaking(null);
        setIsPaused(false);
        isPausedRef.current = false;
        setAwaitingFirstAssistantTurn(false);
        setPendingAssistantTranscript("");
        pendingUserTranscriptRef.current = "";
        awaitingFirstAssistantTurnRef.current = false;
        assistantAudioInCurrentTurnRef.current = false;
        pendingAssistantTranscriptRef.current = "";
        lastFinalUserTranscriptRef.current = "";
        setSessionState("idle");
      },
      onTextReceived: (text, isFinal) => {
        log("Text received:", text, "final:", isFinal);
        const merged = mergeTranscriptChunk(pendingAssistantTranscriptRef.current, text);
        pendingAssistantTranscriptRef.current = merged;
        setPendingAssistantTranscript(merged);
        if (merged) {
          setCurrentlySpeaking(merged);
        }

        if (isFinal && merged) {
          commitAssistantMessage(merged);
          setPendingAssistantTranscript("");
          pendingAssistantTranscriptRef.current = "";
        }
      },
      onAudioReceived: () => {
        if (isPausedRef.current) return;
        flushPendingUserTranscript();
        assistantAudioInCurrentTurnRef.current = true;
        setListeningLevel(0);
        setSessionState("speaking");
      },
      onInputAudioLevel: (level) => {
        setListeningLevel((prev) => Math.max(level, prev * 0.55));
      },
      onUserTranscription: (text, isFinal) => {
        if (isPausedRef.current) return;
        if (!text) return;
        pendingUserTranscriptRef.current = mergeTranscriptChunk(
          pendingUserTranscriptRef.current,
          text
        );
        scheduleUserTranscriptFlush(isFinal ? 220 : 2500);
      },
      onTranscriptEntry: (entry) => {
        appendTranscriptEntry(entry);
      },
      onAppEvent: (event: LiveAppEvent) => {
        if (event.type === "REQUIRE_EDIT_CONFIRM") {
          const instruction = event.instruction?.trim();
          if (!instruction) return;
          setPendingEditPrompt(instruction);
          pendingEditPromptRef.current = instruction;

          // Instead of showing immediately, queue it to show when playback completes
          setQueuedEditConfirm(true);

          setIsEditing(false);
          isEditingRef.current = false;
          if (!isPausedRef.current) {
            setSessionState("listening");
          }
          return;
        }

        if (event.type === "EDIT_STATUS" && event.status === "editing") {
          setShowEditConfirm(false);
          setIsEditing(true);
          isEditingRef.current = true;
          setSessionState("editing");
          return;
        }

        if (event.type === "EDIT_COMPLETED") {
          setIsEditing(false);
          isEditingRef.current = false;
          const instruction =
            (event.instruction || pendingEditPromptRef.current || "").trim();
          if (event.imageBase64 && instruction) {
            applyEditedImageVersion(
              event.imageBase64,
              event.mimeType || imageMimeTypeRef.current,
              instruction
            );

            // Send the edited image right back to Gemini so it can react verbally
            const activeSession = liveSessionRef.current;
            if (activeSession) {
              const prompt = `I have just edited the photo according to your suggestion: "${instruction}". What do you see in the new version?`;
              activeSession.sendImage(event.imageBase64, event.mimeType || imageMimeTypeRef.current, prompt);
            }
          }
          clearPendingEditConfirmation();
          setSessionState("listening");
          return;
        }

        if (event.type === "EDIT_FAILED") {
          setIsEditing(false);
          isEditingRef.current = false;
          const instruction = event.instruction?.trim();
          if (instruction) {
            setPendingEditPrompt(instruction);
            pendingEditPromptRef.current = instruction;
            setShowEditConfirm(true);
          }
          if (event.error) {
            setLiveError(event.error);
          }
          if (!isPausedRef.current) {
            setSessionState("listening");
          }
          return;
        }

        if (event.type === "EDIT_CONFIRM_CANCELLED") {
          clearPendingEditConfirmation();
        }
      },
      onError: (error) => {
        log("Live session error:", error);
        clearUserTranscriptCommitTimer();
        clearPendingEditConfirmation();
        setIsEditing(false);
        isEditingRef.current = false;
        setLiveError(error);
        setListeningLevel(0);
        setCurrentlySpeaking(null);
        setIsPaused(false);
        isPausedRef.current = false;
        setAwaitingFirstAssistantTurn(false);
        setPendingAssistantTranscript("");
        pendingUserTranscriptRef.current = "";
        awaitingFirstAssistantTurnRef.current = false;
        assistantAudioInCurrentTurnRef.current = false;
        pendingAssistantTranscriptRef.current = "";
        lastFinalUserTranscriptRef.current = "";
        setSessionState("idle");
      },
      onInterrupted: () => {
        log("Response interrupted");
        setCurrentlySpeaking(null);
        setAwaitingFirstAssistantTurn(false);
        setPendingAssistantTranscript("");
        awaitingFirstAssistantTurnRef.current = false;
        assistantAudioInCurrentTurnRef.current = false;
        pendingAssistantTranscriptRef.current = "";
        lastFinalUserTranscriptRef.current = "";
        if (!isPausedRef.current) {
          setSessionState("listening");
        }
      },
      onPlaybackComplete: () => {
        setCurrentlySpeaking(null);
        assistantAudioInCurrentTurnRef.current = false;
        if (isPausedRef.current) {
          setSessionState("paused");
          return;
        }
        if (awaitingFirstAssistantTurnRef.current) {
          setAwaitingFirstAssistantTurn(false);
          awaitingFirstAssistantTurnRef.current = false;
        }

        // Check if we have a queued edit confirmation to show now
        setQueuedEditConfirm((prev) => {
          if (prev) {
            setShowEditConfirm(true);
          }
          return false;
        });

        setSessionState((prev) => (prev === "editing" ? prev : "listening"));
      },
      onTurnComplete: () => {
        const pendingText = pendingAssistantTranscriptRef.current.replace(/\s+/g, " ").trim();
        if (pendingText) {
          commitAssistantMessage(pendingText);
          setPendingAssistantTranscript("");
          pendingAssistantTranscriptRef.current = "";
        }
        flushPendingUserTranscript();
        if (isPausedRef.current) {
          assistantAudioInCurrentTurnRef.current = false;
          setSessionState("paused");
          return;
        }
        if (awaitingFirstAssistantTurnRef.current && !assistantAudioInCurrentTurnRef.current) {
          setAwaitingFirstAssistantTurn(false);
          awaitingFirstAssistantTurnRef.current = false;
          setSessionState((prev) => (prev === "editing" ? prev : "listening"));
          return;
        }
        if (!awaitingFirstAssistantTurnRef.current) {
          setSessionState((prev) => (prev === "editing" ? prev : "listening"));
        }
        assistantAudioInCurrentTurnRef.current = false;
      },
    };

    let session = createSession(liveCredential, proxyConfigured);
    let connected = await session.connect(sessionCallbacks);

    if (!connected && proxyConfigured) {
      log("Initial proxy connect failed, retrying once...");
      session.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 600));
      setSessionState("connecting");
      setLiveError(null);
      session = createSession("__proxy__", true);
      connected = await session.connect(sessionCallbacks);
    }

    if (!connected && proxyConfigured) {
      log("Proxy connect failed. Trying direct token fallback...");
      const tokenResult = await requestLiveToken();
      if (tokenResult.token) {
        session.disconnect();
        setSessionState("connecting");
        setLiveError("Proxy unstable. Switching to direct Live connection...");
        session = createSession(tokenResult.token, false);
        connected = await session.connect(sessionCallbacks);
      } else if (tokenResult.error) {
        liveTokenError = tokenResult.error;
      }
    }

    if (!connected) {
      log("Failed to connect to Live API");
      if (liveTokenError && proxyConfigured) {
        setLiveError(`Proxy failed and direct fallback token failed: ${liveTokenError}`);
      } else {
        setLiveError("Failed to connect to Gemini Live. Please retry.");
      }
      clearUserTranscriptCommitTimer();
      clearPendingEditConfirmation();
      setListeningLevel(0);
      setIsPaused(false);
      isPausedRef.current = false;
      setAwaitingFirstAssistantTurn(false);
      setPendingAssistantTranscript("");
      pendingUserTranscriptRef.current = "";
      awaitingFirstAssistantTurnRef.current = false;
      assistantAudioInCurrentTurnRef.current = false;
      pendingAssistantTranscriptRef.current = "";
      lastFinalUserTranscriptRef.current = "";
      setSessionState("idle");
    }
  }, [appendTranscriptEntry, clearPendingEditConfirmation, profile]);

  const hydrateConversation = async (id: string) => {
    try {
      const res = await fetch(apiUrl(`/api/conversations/${id}`), {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error("Failed to load conversation");
      const convo = await res.json();

      setImage(convo.imageDataUrl || null);
      const hydratedMimeType = convo.imageMimeType || "image/jpeg";
      setImageMimeType(hydratedMimeType);
      imageMimeTypeRef.current = hydratedMimeType;
      setImageVersions(convo.imageVersions || []);
      const initialIndex = convo.imageVersions.length > 0 ? convo.imageVersions.length - 1 : 0;
      setCurrentImageIndex(initialIndex);
      currentImageIndexRef.current = initialIndex;
      setMessages(convo.messages || []);
      messagesRef.current = convo.messages || [];
      const transcriptHistory: LiveTranscriptEntry[] = (Array.isArray(convo.messages) ? convo.messages : [])
        .map((msg: ChatMessage): LiveTranscriptEntry | null => {
          const normalized = msg.text.replace(/\s+/g, " ").trim();
          if (!normalized) return null;
          return {
            role: msg.role === "user" ? "user" : "ai",
            text: normalized,
            isFinal: true,
          };
        })
        .filter((item: LiveTranscriptEntry | null): item is LiveTranscriptEntry => item !== null);
      setTranscriptEntries(transcriptHistory);
      clearPendingEditConfirmation();
      setPendingAssistantTranscript("");
      pendingAssistantTranscriptRef.current = "";

    } catch (err) {
      console.error("Hydrate error:", err);
    } finally {
      setHydrated(true);
    }
  };

  const saveConversation = async (msgs?: ChatMessage[], versions?: ImageVersion[]) => {
    const id = convoIdRef.current;
    if (!id) return;

    const body: any = {};
    if (msgs) body.messages = msgs;
    if (versions) body.imageVersions = versions;

    try {
      await fetch(apiUrl(`/api/conversations/${id}`), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.error("Save error:", err);
    }
  };

  // Prime WebAudio on user gesture to reduce autoplay-related playback failures.
  const primeWebAudio = async () => {
    try {
      const AudioCtx =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      const context: AudioContext = new AudioCtx();
      if (context.state === "suspended") {
        await context.resume();
      }

      const osc = context.createOscillator();
      const gain = context.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start();
      osc.stop(context.currentTime + 0.01);

      window.setTimeout(() => {
        void context.close();
      }, 50);
    } catch (err) {
      log("WebAudio prime failed:", err);
    }
  };

  // Warm mic permission on user gesture to reduce iOS/Safari capture failures.
  const warmupMicrophonePermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      stream.getTracks().forEach((track) => track.stop());
    } catch (err) {
      log("Microphone warmup skipped:", err);
    }
  };

  // Image upload with HEIC support
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    void primeWebAudio();
    void warmupMicrophonePermission();

    const file = e.target.files?.[0];
    if (!file) return;

    let processedFile: Blob = file;
    let mimeType = file.type;

    // Handle HEIC
    if (
      file.type === "image/heic" ||
      file.type === "image/heif" ||
      file.name.toLowerCase().endsWith(".heic") ||
      file.name.toLowerCase().endsWith(".heif")
    ) {
      try {
        const heic2any = (await import("heic2any")).default;
        const converted = await heic2any({
          blob: file,
          toType: "image/jpeg",
          quality: 0.9,
        });
        processedFile = Array.isArray(converted) ? converted[0] : converted;
        mimeType = "image/jpeg";
      } catch (err) {
        console.error("HEIC conversion failed:", err);
        alert("Failed to convert HEIC. Please try JPEG or PNG.");
        return;
      }
    }

    const resolvedMimeType = mimeType || "image/jpeg";
    setImageMimeType(resolvedMimeType);
    imageMimeTypeRef.current = resolvedMimeType;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      setImage(dataUrl);
      setIsNewUpload(true);

      const firstVersion: ImageVersion = {
        dataUrl,
        editPrompt: "",
        timestamp: Date.now(),
      };
      setImageVersions([firstVersion]);
      setCurrentImageIndex(0);
      currentImageIndexRef.current = 0;
      imageVersionsRef.current = [firstVersion];
      setMessages([]);
      setTranscriptEntries([]);
      setIsPaused(false);
      isPausedRef.current = false;
      clearUserTranscriptCommitTimer();
      clearPendingEditConfirmation();
      pendingUserTranscriptRef.current = "";
      messagesRef.current = [];
      setPendingAssistantTranscript("");
      pendingAssistantTranscriptRef.current = "";

      // Create conversation on backend
      try {
        const res = await fetch(apiUrl("/api/conversations"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({
            imageDataUrl: dataUrl,
            imageMimeType: resolvedMimeType,
          }),
        });
        const data = await res.json();
        setConvoId(data.id);
        convoIdRef.current = data.id;
        setHasStartedSession(true);
        setLiveError(null);

        // Start Live API session
        startLiveSession(dataUrl, resolvedMimeType);
      } catch (err) {
        console.error("Failed to create conversation:", err);
      }
    };
    reader.readAsDataURL(processedFile);
  };

  // Handle continuing a conversation
  const handleContinueConversation = () => {
    if (image) {
      void primeWebAudio();
      void warmupMicrophonePermission();
      setHasStartedSession(true);  // Mark that session has been started to prevent loop
      setShowWelcomeBack(false);
      setLiveError(null);
      startLiveSession(image, imageMimeType, true);
    }
  };

  // Handle back from welcome screen
  const handleBackFromWelcome = () => {
    setShowWelcomeBack(false);
    onBack();
  };

  // End session
  const handleEndSession = async () => {
    if (isSaving) return;
    setIsSaving(true);
    clearUserTranscriptCommitTimer();
    clearPendingEditConfirmation();
    pendingUserTranscriptRef.current = "";
    setIsPaused(false);
    isPausedRef.current = false;
    // Close Live API connection
    if (liveSessionRef.current) {
      liveSessionRef.current.disconnect();
      liveSessionRef.current = null;
    }

    try {
      // Generate summary if meaningful conversation
      if (messages.length >= 2) {
        try {
          const convoText = messages.map((m) => `${m.role}: ${m.text}`).join("\n");
          const summaryRes = await fetch(apiUrl("/api/chat"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: [
                {
                  role: "user",
                  text: `Summarize this conversation in 2-3 sentences for a user profile. Focus on what the user recalled, their emotions, and preferences:\n\n${convoText}`,
                },
              ],
            }),
          });
          const summaryData = await summaryRes.json();

          if (summaryData.text && profile) {
            await fetch(apiUrl("/api/profile"), {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${getToken()}`,
              },
              body: JSON.stringify({
                conversationSummaries: [
                  ...profile.conversationSummaries,
                  `[${new Date().toLocaleDateString()}] ${summaryData.text}`,
                ],
              }),
            });
          }
        } catch (err) {
          console.error("Failed to summarize:", err);
        }
      }

      onBack();
    } finally {
      setIsSaving(false);
    }
  };

  const handleTogglePause = async () => {
    const session = liveSessionRef.current;
    if (!session || !session.isConnected()) return;

    if (isPausedRef.current) {
      const resumed = await session.startAudioInput();
      if (!resumed) {
        setLiveError("Unable to resume microphone. Please check microphone permission.");
        return;
      }
      setLiveError(null);
      setIsPaused(false);
      isPausedRef.current = false;
      setSessionState("listening");
      return;
    }

    clearUserTranscriptCommitTimer();
    pendingUserTranscriptRef.current = "";
    session.interrupt();
    session.stopAudioInput();
    setListeningLevel(0);
    setCurrentlySpeaking(null);
    setPendingAssistantTranscript("");
    pendingAssistantTranscriptRef.current = "";
    setIsPaused(true);
    isPausedRef.current = true;
    setSessionState("paused");
  };

  const handleConfirmEdit = async () => {
    const editPrompt = pendingEditPromptRef.current?.trim();
    const session = liveSessionRef.current;
    if (!editPrompt || !session) return;

    const activeVersion = imageVersionsRef.current[currentImageIndexRef.current];
    if (!activeVersion?.dataUrl?.includes(",")) {
      setLiveError("No active photo available for editing.");
      return;
    }

    const base64 = activeVersion.dataUrl.split(",")[1];
    setShowEditConfirm(false);
    setIsEditing(true);
    isEditingRef.current = true;
    setSessionState("editing");

    if (isPausedRef.current) {
      setIsPaused(false);
      isPausedRef.current = false;
    }

    clearUserTranscriptCommitTimer();
    pendingUserTranscriptRef.current = "";
    session.confirmEdit(editPrompt, base64, imageMimeTypeRef.current);
    const micReady = await session.startAudioInput();
    if (!micReady) {
      setLiveError("Microphone failed to restart for continued conversation.");
    }
  };

  const handleCancelEdit = () => {
    clearPendingEditConfirmation(true);
  };

  // Gallery handlers
  const handleGallerySelect = (index: number) => {
    setCurrentImageIndex(index);
    currentImageIndexRef.current = index;
  };

  // Handle using a specific version from gallery
  const handleUseVersion = (index: number) => {
    // Send message and image to AI that we're using this version
    const session = liveSessionRef.current;
    if (session && imageVersions[index]) {
      const versionLabel = index === 0 ? "the original photo" : `version ${index}`;
      const prompt = `I have restored ${versionLabel} as the active photo. Please ask me if I want to continue discussing the details of this version.`;

      const targetVersion = imageVersions[index];
      // Note: older versions might not have stored mimeType separately, fallback to image/jpeg
      const mimeType = (targetVersion as any).mimeType || imageMimeTypeRef.current || "image/jpeg";

      const base64Data = targetVersion.dataUrl.includes("base64,")
        ? targetVersion.dataUrl.split("base64,")[1]
        : targetVersion.dataUrl;

      session.sendImage(base64Data, mimeType, prompt);

      // Ensure the listening UI indicates we are back to active session
      if (sessionState === "paused") {
        setIsPaused(false);
        isPausedRef.current = false;
        setSessionState("listening");
      } else if (sessionState !== "speaking") {
        setSessionState("listening");
      }
    }
  };

  // Current image
  const currentImage =
    imageVersions.length > 0
      ? imageVersions[currentImageIndex]?.dataUrl
      : image;
  const transcriptMessages: Array<{ role: "user" | "model"; text: string }> = transcriptEntries.map((entry) => ({
    role: entry.role === "user" ? "user" : "model",
    text: entry.text,
  }));
  const safeListeningLevel = Math.max(0, Math.min(1, listeningLevel));
  const listeningBarMultipliers = [0.55, 0.78, 1, 0.78, 0.55];
  const transcriptPreparing =
    messages.length === 0 &&
    pendingAssistantTranscript.trim().length === 0 &&
    (sessionState === "connecting" ||
      sessionState === "speaking" ||
      sessionState === "listening" ||
      awaitingFirstAssistantTurn);

  // Loading state - with SF Symbol style icon
  if (!hydrated) {
    return (
      <div className="fixed inset-0 bg-[#f7f7f8] flex items-center justify-center">
        <div className="w-12 h-12 border-[3px] border-[#007aff] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Upload mode - no image yet
  if (!image) {
    return (
      <div className="fixed inset-0 bg-[#f7f7f8] flex flex-col">
        {/* Header */}
        <div className="safe-top px-4 py-4 flex items-center justify-between bg-white border-b border-gray-200">
          <button
            onClick={onBack}
            className="w-10 h-10 rounded-full bg-black/5 flex items-center justify-center text-[#1d1d1f] active:scale-95 transition-transform"
            aria-label="Back"
          >
            <ChevronLeft size={20} strokeWidth={2.5} />
          </button>
          <h1 className="text-lg font-semibold text-[#1d1d1f]">New Session</h1>
          <div className="w-10" />
        </div>

        {/* Upload area */}
        <div className="flex-1 flex items-center justify-center p-8">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            onChange={handleImageUpload}
            className="hidden"
          />
          <button
            onClick={() => {
              void primeWebAudio();
              void warmupMicrophonePermission();
              fileInputRef.current?.click();
            }}
            className="bg-white w-full max-w-sm aspect-square rounded-3xl flex flex-col items-center justify-center gap-4 border-2 border-dashed border-gray-300 hover:border-[#007aff] hover:bg-blue-50/30 active:scale-[0.98] transition-all"
          >
            <div className="w-20 h-20 rounded-full bg-blue-100 flex items-center justify-center text-[#007aff]">
              <Camera size={40} strokeWidth={2.2} />
            </div>
            <div className="text-center">
              <p className="text-lg font-medium text-[#1d1d1f]">Upload a photo</p>
              <p className="text-sm text-[#86868b] mt-1">
                JPEG, PNG, or HEIC
              </p>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // Main immersive view
  return (
    <div className={`fixed inset-0 bg-[#f7f7f8] ${isLandscape ? "immersive-layout" : ""}`}>
      {/* Photo section */}
      <div className={isLandscape ? "photo-section" : "fixed inset-0"}>
        {/* Fullscreen image */}
        <img
          src={currentImage || ""}
          alt="Photo"
          className="fullscreen-image"
        />

        {/* Light gradient overlay for readability (portrait only) */}
        {!isLandscape && (
          <div className="fixed inset-0 bg-gradient-to-t from-white/70 via-transparent to-white/30 pointer-events-none" />
        )}
      </div>

      {/* Connecting/Preparing indicator */}
      {sessionState === "connecting" && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40">
          <div className="bg-white/90 backdrop-blur-sm px-4 py-2.5 rounded-full flex items-center gap-2.5 shadow-lg border border-black/5">
            <div className="preparing-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <span className="text-sm font-medium text-[#1d1d1f]">Preparing</span>
          </div>
        </div>
      )}

      {(sessionState === "listening" || sessionState === "speaking") && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40">
          <div className="bg-white/90 backdrop-blur-sm px-4 py-2.5 rounded-full flex items-center gap-2.5 shadow-lg border border-black/5">
            {sessionState === "listening" ? (
              <>
                <div className="listening-indicator">
                  {listeningBarMultipliers.map((multiplier, index) => {
                    const minHeight = 5 + (index % 2);
                    const dynamicHeight = Math.round((6 + safeListeningLevel * 14) * multiplier);
                    return (
                      <span
                        key={`top-listening-level-${index}`}
                        style={{ height: `${Math.max(minHeight, dynamicHeight)}px` }}
                      />
                    );
                  })}
                </div>
                <span className="text-sm font-medium text-[#007aff]">Listening</span>
              </>
            ) : (
              <>
                <div className="w-2.5 h-2.5 bg-[#34c759] rounded-full speaking" />
                <span className="text-sm font-medium text-[#34c759]">Speaking</span>
              </>
            )}
          </div>
        </div>
      )}

      {sessionState === "paused" && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40">
          <div className="bg-white/90 backdrop-blur-sm px-4 py-2.5 rounded-full flex items-center gap-2.5 shadow-lg border border-black/5">
            <div className="w-2.5 h-2.5 bg-[#ff9f0a] rounded-full" />
            <span className="text-sm font-medium text-[#ff9f0a]">Paused</span>
          </div>
        </div>
      )}



      {/* Live connection/microphone error */}
      {liveError && (
        <div className="fixed top-20 left-4 right-4 z-40">
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2 text-sm flex items-start justify-between gap-2">
            <span>{liveError}</span>
            <button
              onClick={() => setLiveError(null)}
              className="w-7 h-7 rounded-full bg-red-100 border border-red-200 flex items-center justify-center text-red-500 hover:text-red-700"
              aria-label="Dismiss error"
            >
              <X size={18} strokeWidth={2.4} />
            </button>
          </div>
        </div>
      )}

      {showEditConfirm && pendingEditPrompt && !isEditing && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[88vw] max-w-md">
          <div className="bg-white/92 backdrop-blur-xl border border-black/10 rounded-2xl shadow-xl p-4">
            <div className="flex items-center gap-2 text-[#007aff] mb-2">
              <Sparkles size={18} strokeWidth={2.2} />
              <span className="text-sm font-semibold">Ready to edit</span>
            </div>
            <p className="text-sm text-[#1d1d1f] leading-relaxed mb-3">
              {pendingEditPrompt}
            </p>
            <button
              onClick={() => {
                void handleConfirmEdit();
              }}
              className="w-full h-11 rounded-xl bg-[#007aff] text-white font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
            >
              <Check size={18} strokeWidth={2.6} />
              Confirm Edit
            </button>
            <button
              onClick={handleCancelEdit}
              className="w-full mt-2 h-10 rounded-xl text-[#86868b] font-medium active:bg-black/5 transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {/* Welcome back overlay */}
      {showWelcomeBack && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full text-center shadow-xl">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center text-[#007aff]">
              <RotateCcw size={24} strokeWidth={2.2} />
            </div>
            <h2 className="text-xl font-semibold text-[#1d1d1f] mb-2">
              Welcome back!
            </h2>
            <p className="text-[#86868b] mb-6">
              Ready to continue where you left off?
            </p>
            <div className="space-y-3">
              <button
                onClick={handleContinueConversation}
                className="w-full py-3 bg-[#007aff] text-white font-semibold rounded-xl active:scale-[0.98] transition-transform"
              >
                Continue Conversation
              </button>
              <button
                onClick={handleBackFromWelcome}
                className="w-full py-3 text-[#86868b] font-medium active:bg-gray-100 rounded-xl transition-colors"
              >
                Back
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Editing overlay */}
      {isEditing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white/95 backdrop-blur-md px-6 py-4 rounded-full flex items-center gap-3.5 shadow-xl border border-black/5">
            <div className="preparing-dots scale-110" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <span className="text-base font-medium text-[#1d1d1f]">Editing</span>
          </div>
        </div>
      )}

      {/* Saving Session overlay */}
      {isSaving && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white/95 backdrop-blur-md px-6 py-4 rounded-full flex items-center gap-3.5 shadow-xl border border-black/5">
            <div className="preparing-dots scale-110" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <span className="text-base font-medium text-[#1d1d1f]">Saving</span>
          </div>
        </div>
      )}

      {/* Floating transcript */}
      <FloatingTranscript
        messages={transcriptMessages}
        visible={showTranscript}
        currentlySpeaking={currentlySpeaking}
        isPreparing={transcriptPreparing}
        pendingAssistantText={pendingAssistantTranscript}
      />

      {/* Control bar */}
      <ControlBar
        showTranscript={showTranscript}
        isPaused={isPaused}
        isSaving={isSaving}
        onToggleTranscript={() => setShowTranscript(!showTranscript)}
        onTogglePause={() => {
          void handleTogglePause();
        }}
        onEndSession={handleEndSession}
        onOpenGallery={() => setShowGallery(true)}
      />

      {/* Version gallery modal */}
      {showGallery && (
        <VersionGallery
          versions={imageVersions}
          currentIndex={currentImageIndex}
          onSelect={handleGallerySelect}
          onClose={() => setShowGallery(false)}
          onUseVersion={handleUseVersion}
        />
      )}
    </div>
  );
}
