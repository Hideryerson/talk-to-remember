"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { getToken } from "@/lib/auth";
import { apiUrl, getBackendWsUrl } from "@/lib/api";
import {
  LiveSession,
  DEFAULT_SYSTEM_INSTRUCTION,
  PHOTO_EDIT_TOOL,
  type LiveSessionCallbacks,
  type ToolCall,
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

type SessionState = "idle" | "connecting" | "listening" | "speaking" | "editing";

const DEBUG = true;
function log(...args: any[]) {
  if (DEBUG) console.log("[ImmersiveChat]", ...args);
}

// SF Symbols style icons
const SFSymbols = {
  // chevron.left - Back
  chevronLeft: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  // camera.fill - Upload photo
  cameraFill: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 15.2a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4z" />
      <path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" />
    </svg>
  ),
  // iphone landscape hint
  rotatePhone: (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="13" y="16" width="23" height="40" rx="5" opacity="0.35" />
      <rect x="36" y="25" width="23" height="23" rx="5" />
      <path className="rotate-hint-arrow" d="M22 10c8-6 20-6 28 2" />
      <path className="rotate-hint-arrow" d="M50 12l-1.5-5 5 1.5" />
    </svg>
  ),
  // arrow.clockwise - Continue
  arrowClockwise: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  ),
  // ellipsis.message - Preparing
  preparing: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" />
      <circle cx="8" cy="10" r="1" fill="currentColor" />
      <circle cx="12" cy="10" r="1" fill="currentColor" />
      <circle cx="16" cy="10" r="1" fill="currentColor" />
    </svg>
  ),
  // xmark
  xmark: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
};

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
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [showTranscript, setShowTranscript] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [currentlySpeaking, setCurrentlySpeaking] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showRotateHint, setShowRotateHint] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState(1);
  const [showWelcomeBack, setShowWelcomeBack] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const [isNewUpload, setIsNewUpload] = useState(false);
  const [hasStartedSession, setHasStartedSession] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [awaitingFirstAssistantTurn, setAwaitingFirstAssistantTurn] = useState(false);
  const [listeningLevel, setListeningLevel] = useState(0);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const imageVersionsRef = useRef<ImageVersion[]>([]);
  const convoIdRef = useRef<string | null>(convoId);
  const liveSessionRef = useRef<LiveSession | null>(null);
  const pendingToolCallRef = useRef<ToolCall | null>(null);
  const currentImageIndexRef = useRef(0);
  const isEditingRef = useRef(false);
  const imageMimeTypeRef = useRef(imageMimeType);
  const awaitingFirstAssistantTurnRef = useRef(false);
  const assistantAudioInCurrentTurnRef = useRef(false);

  // Keep refs in sync
  useEffect(() => {
    messagesRef.current = messages;
    imageVersionsRef.current = imageVersions;
    convoIdRef.current = convoId;
    currentImageIndexRef.current = currentImageIndex;
    isEditingRef.current = isEditing;
    imageMimeTypeRef.current = imageMimeType;
    awaitingFirstAssistantTurnRef.current = awaitingFirstAssistantTurn;
  }, [messages, imageVersions, convoId, currentImageIndex, isEditing, imageMimeType, awaitingFirstAssistantTurn]);

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

      // Hide rotate hint when landscape
      if (isLand && imageAspectRatio > 1.2) {
        setShowRotateHint(false);
      }
    };

    checkOrientation();
    const mq = window.matchMedia("(orientation: landscape)");
    mq.addEventListener("change", checkOrientation);
    return () => mq.removeEventListener("change", checkOrientation);
  }, [imageAspectRatio]);

  // Hydrate existing conversation
  useEffect(() => {
    if (conversationId) {
      hydrateConversation(conversationId);
    } else {
      setHydrated(true);
    }

    // Cleanup on unmount
    return () => {
      if (liveSessionRef.current) {
        liveSessionRef.current.disconnect();
      }
    };
  }, [conversationId]);

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
        tools: [PHOTO_EDIT_TOOL],
        voiceName: "Puck",
        useProxy,
      });
      liveSessionRef.current = createdSession;
      return createdSession;
    };

    setSessionState("connecting");
    setShowWelcomeBack(false);
    setLiveError(null);
    setListeningLevel(0);
    setAwaitingFirstAssistantTurn(true);
    awaitingFirstAssistantTurnRef.current = true;
    assistantAudioInCurrentTurnRef.current = false;

    const sessionCallbacks: LiveSessionCallbacks = {
      onConnected: () => {
        log("Live session connected");
        setLiveError(null);
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
            awaitingFirstAssistantTurnRef.current = false;
          }
        });
      },
      onDisconnected: () => {
        log("Live session disconnected");
        setListeningLevel(0);
        setCurrentlySpeaking(null);
        setAwaitingFirstAssistantTurn(false);
        awaitingFirstAssistantTurnRef.current = false;
        assistantAudioInCurrentTurnRef.current = false;
        setSessionState("idle");
      },
      onTextReceived: (text, isFinal) => {
        log("Text received:", text, "final:", isFinal);
        if (isFinal && text.trim()) {
          // Add AI message
          const newMsg: ChatMessage = { role: "model", text };
          const updated = [...messagesRef.current, newMsg];
          setMessages(updated);
          messagesRef.current = updated;
          setCurrentlySpeaking(text);
          saveConversation(updated);
        }
      },
      onAudioReceived: () => {
        assistantAudioInCurrentTurnRef.current = true;
        setListeningLevel(0);
        setSessionState("speaking");
      },
      onInputAudioLevel: (level) => {
        setListeningLevel((prev) => Math.max(level, prev * 0.55));
      },
      onToolCall: async (toolCall) => {
        log("Tool call received:", toolCall);
        if (toolCall.name === "edit_image") {
          pendingToolCallRef.current = toolCall;
          const editPrompt =
            typeof toolCall.args?.editPrompt === "string"
              ? toolCall.args.editPrompt
              : "";

          if (!editPrompt.trim()) {
            if (liveSessionRef.current) {
              liveSessionRef.current.sendToolResult(toolCall.id, {
                success: false,
                message: "Missing editPrompt argument.",
              });
            }
            pendingToolCallRef.current = null;
            return;
          }

          // Execute the edit
          const success = await handleEditImage(editPrompt);

          // Send result back to Live API
          if (liveSessionRef.current) {
            liveSessionRef.current.sendToolResult(toolCall.id, {
              success,
              message: success
                ? `Photo edited: ${editPrompt}`
                : `Photo edit failed: ${editPrompt}`,
            });
          }
          pendingToolCallRef.current = null;
        }
      },
      onError: (error) => {
        log("Live session error:", error);
        setLiveError(error);
        setListeningLevel(0);
        setCurrentlySpeaking(null);
        setAwaitingFirstAssistantTurn(false);
        awaitingFirstAssistantTurnRef.current = false;
        assistantAudioInCurrentTurnRef.current = false;
        setSessionState("idle");
      },
      onInterrupted: () => {
        log("Response interrupted");
        setCurrentlySpeaking(null);
        setAwaitingFirstAssistantTurn(false);
        awaitingFirstAssistantTurnRef.current = false;
        assistantAudioInCurrentTurnRef.current = false;
        setSessionState("listening");
      },
      onPlaybackComplete: () => {
        setCurrentlySpeaking(null);
        assistantAudioInCurrentTurnRef.current = false;
        if (awaitingFirstAssistantTurnRef.current) {
          setAwaitingFirstAssistantTurn(false);
          awaitingFirstAssistantTurnRef.current = false;
        }
        setSessionState((prev) => (prev === "editing" ? prev : "listening"));
      },
      onTurnComplete: () => {
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
      setListeningLevel(0);
      setAwaitingFirstAssistantTurn(false);
      awaitingFirstAssistantTurnRef.current = false;
      assistantAudioInCurrentTurnRef.current = false;
      setSessionState("idle");
    }
  }, [profile]);

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

      // Check image aspect ratio
      if (convo.imageDataUrl) {
        const img = new Image();
        img.onload = () => {
          const ratio = img.width / img.height;
          setImageAspectRatio(ratio);
        };
        img.src = convo.imageDataUrl;
      }
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

      // Check image aspect ratio for rotation hint
      const img = new Image();
      img.onload = () => {
        const ratio = img.width / img.height;
        setImageAspectRatio(ratio);

        // Landscape photo + portrait device = show hint
        if (ratio > 1.2 && window.matchMedia("(orientation: portrait)").matches) {
          setShowRotateHint(true);
        }
      };
      img.src = dataUrl;

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
      messagesRef.current = [];

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

  // Edit image handler (called via Function Calling)
  const handleEditImage = async (prompt: string): Promise<boolean> => {
    if (!prompt.trim() || imageVersionsRef.current.length === 0 || isEditingRef.current) {
      return false;
    }

    setIsEditing(true);
    isEditingRef.current = true;
    setSessionState("editing");

    try {
      const safeIndex = Math.min(
        Math.max(currentImageIndexRef.current, 0),
        imageVersionsRef.current.length - 1
      );
      const currentVersion = imageVersionsRef.current[safeIndex];
      if (!currentVersion?.dataUrl) {
        throw new Error("No image version available for editing.");
      }
      const base64 = currentVersion.dataUrl.split(",")[1];

      const res = await fetch(apiUrl("/api/edit-image"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType: imageMimeTypeRef.current,
          editPrompt: prompt,
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const newDataUrl = `data:${data.mimeType};base64,${data.imageBase64}`;
      const newVersion: ImageVersion = {
        dataUrl: newDataUrl,
        editPrompt: prompt,
        timestamp: Date.now(),
      };

      const newVersions = [...imageVersionsRef.current, newVersion];
      setImageVersions(newVersions);
      setCurrentImageIndex(newVersions.length - 1);
      currentImageIndexRef.current = newVersions.length - 1;
      imageVersionsRef.current = newVersions;

      saveConversation(undefined, newVersions);
      log("Image edited successfully:", prompt);
      return true;
    } catch (err: any) {
      console.error("Edit failed:", err);
      return false;
    } finally {
      setIsEditing(false);
      isEditingRef.current = false;
      setSessionState("listening");
    }
  };

  // End session
  const handleEndSession = async () => {
    // Close Live API connection
    if (liveSessionRef.current) {
      liveSessionRef.current.disconnect();
      liveSessionRef.current = null;
    }

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
  };

  // Gallery handlers
  const handleGallerySelect = (index: number) => {
    setCurrentImageIndex(index);
    currentImageIndexRef.current = index;
  };

  // Handle using a specific version from gallery
  const handleUseVersion = (index: number) => {
    // Send message to AI that we're using this version
    if (liveSessionRef.current && imageVersions[index]) {
      const versionLabel = index === 0 ? "the original photo" : `version ${index}`;
      liveSessionRef.current.sendText(`I'd like to continue with ${versionLabel}.`);
    }
  };

  // Current image
  const currentImage =
    imageVersions.length > 0
      ? imageVersions[currentImageIndex]?.dataUrl
      : image;
  const transcriptPreparing =
    messages.length === 0 &&
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
            {SFSymbols.chevronLeft}
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
              {SFSymbols.cameraFill}
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
              {SFSymbols.xmark}
            </button>
          </div>
        </div>
      )}

      {/* Rotate phone hint */}
      {showRotateHint && (
        <div
          className="fixed inset-0 z-50 rotate-hint-overlay flex flex-col items-center justify-center gap-6"
          onClick={() => setShowRotateHint(false)}
        >
          <div className="rotate-phone-icon text-white">
            {SFSymbols.rotatePhone}
          </div>
          <p className="text-white text-lg font-medium text-center px-8">
            Rotate your phone for a better view
          </p>
          <p className="text-white/60 text-sm">
            Tap anywhere to dismiss
          </p>
        </div>
      )}

      {/* Welcome back overlay */}
      {showWelcomeBack && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full text-center shadow-xl">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center text-[#007aff]">
              {SFSymbols.arrowClockwise}
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
          <div className="bg-white/95 backdrop-blur-md px-6 py-4 rounded-2xl flex items-center gap-3 shadow-lg">
            <div className="w-6 h-6 border-2 border-[#007aff] border-t-transparent rounded-full animate-spin" />
            <span className="text-lg text-[#1d1d1f]">Editing photo...</span>
          </div>
        </div>
      )}

      {/* Floating transcript */}
      <FloatingTranscript
        messages={messages}
        visible={showTranscript}
        currentlySpeaking={currentlySpeaking}
        isPreparing={transcriptPreparing}
      />

      {/* Control bar */}
      <ControlBar
        showTranscript={showTranscript}
        onToggleTranscript={() => setShowTranscript(!showTranscript)}
        onEndSession={handleEndSession}
        onOpenGallery={() => setShowGallery(true)}
        isListening={sessionState === "listening"}
        isSpeaking={sessionState === "speaking"}
        listeningLevel={listeningLevel}
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
