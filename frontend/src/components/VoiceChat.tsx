"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { getToken } from "@/lib/auth";
import { apiUrl } from "@/lib/api";
import {
  speakWithTranscript,
  stopSpeaking,
  unlockAudio,
  isAudioReady,
  isSpeaking as isPipelineSpeaking,
  prefetchTTS,
} from "@/lib/speakingPipeline";
import {
  startRecording,
  stopRecording,
  cancelRecording,
  getRecordingCapabilities,
  getRecorderDebugInfo,
  type RecordingState,
} from "@/lib/audioRecorder";
import type { ChatMessage, ImageVersion, UserProfile } from "@/lib/types";
import ImageHistory from "@/components/ImageHistory";

interface VoiceChatProps {
  conversationId: string | null;
  profile: UserProfile;
  onBack: () => void;
}

type VoiceStatus = "idle" | "recording" | "transcribing" | "processing" | "speaking";

// Debug flag
const DEBUG = true;
function log(...args: any[]) {
  if (DEBUG) console.log("[VoiceChat]", ...args);
}

export default function VoiceChat({ conversationId, profile, onBack }: VoiceChatProps) {
  const [convoId, setConvoId] = useState<string | null>(conversationId);
  const [image, setImage] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState("image/jpeg");
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [imageVersions, setImageVersions] = useState<ImageVersion[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [isLoading, setIsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [showAudioPrompt, setShowAudioPrompt] = useState(false);
  const [pendingFirstMessage, setPendingFirstMessage] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [speakingStatus, setSpeakingStatus] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<string | null>(null);

  // Assistant message that's being spoken (shown when audio starts)
  const [speakingMessage, setSpeakingMessage] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const imageRef = useRef<string | null>(null);
  const currentImageRef = useRef<string | null>(null);
  const convoIdRef = useRef<string | null>(convoId);
  const imageVersionsRef = useRef<ImageVersion[]>([]);
  const textInputRef = useRef<HTMLInputElement>(null);
  const pendingAssistantTextRef = useRef<string | null>(null);

  // Keep refs in sync (single effect for efficiency)
  useEffect(() => {
    messagesRef.current = messages;
    imageRef.current = image;
    currentImageRef.current = currentImage;
    convoIdRef.current = convoId;
    imageVersionsRef.current = imageVersions;
  }, [messages, image, currentImage, convoId, imageVersions]);

  // Hydrate on mount
  useEffect(() => {
    if (conversationId) {
      hydrateConversation(conversationId);
    } else {
      setHydrated(true);
    }
    setAudioUnlocked(isAudioReady());
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, speakingMessage]);

  // Auto-focus text input when hydrated with image
  useEffect(() => {
    if (hydrated && image) {
      textInputRef.current?.focus();
    }
  }, [hydrated, image]);

  // Trigger first message after image upload
  // Use a ref to track if we've already sent the first message to prevent re-triggers
  const firstMessageSentRef = useRef(false);

  useEffect(() => {
    if (pendingFirstMessage && image && convoId && !firstMessageSentRef.current) {
      firstMessageSentRef.current = true;
      setPendingFirstMessage(false);

      if (!audioUnlocked) {
        log("Audio not unlocked for first message, showing prompt");
        setShowAudioPrompt(true);
        pendingAssistantTextRef.current = "I just uploaded a photo from today. What do you see?";
      } else {
        doSendMessage("I just uploaded a photo from today. What do you see?");
      }
    }
  }, [pendingFirstMessage, image, convoId]); // Remove audioUnlocked from deps to prevent re-triggers

  const hydrateConversation = async (id: string) => {
    try {
      const res = await fetch(apiUrl(`/api/conversations/${id}`), {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error("Failed to load conversation");
      const convo = await res.json();

      setImage(convo.imageDataUrl || null);
      setImageMimeType(convo.imageMimeType || "image/jpeg");
      setCurrentImage(
        convo.imageVersions.length > 0
          ? convo.imageVersions[convo.imageVersions.length - 1].dataUrl
          : convo.imageDataUrl || null
      );
      setImageVersions(convo.imageVersions || []);
      setMessages(convo.messages || []);
      messagesRef.current = convo.messages || [];
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

  // Handle audio unlock from user gesture
  const handleAudioUnlock = useCallback(async () => {
    log("handleAudioUnlock called");
    const success = await unlockAudio();
    setAudioUnlocked(success);
    setShowAudioPrompt(false);

    if (success && pendingAssistantTextRef.current) {
      log("Audio unlocked, sending pending message");
      const pendingText = pendingAssistantTextRef.current;
      pendingAssistantTextRef.current = null;
      doSendMessage(pendingText);
    }

    return success;
  }, []);

  // Voice recording with MediaRecorder + server-side transcription
  const handleMicPress = useCallback(async () => {
    setVoiceError(null);

    // If currently recording, stop
    if (voiceStatus === "recording") {
      log("Stopping recording");
      await stopRecording();
      return;
    }

    // If speaking, stop and start recording
    if (isPipelineSpeaking()) {
      log("Stopping speech to start recording");
      stopSpeaking();
      setSpeakingMessage(null);
      setSpeakingStatus(null);
    }

    // Ensure audio is unlocked
    if (!audioUnlocked) {
      const success = await handleAudioUnlock();
      if (!success) {
        log("Audio unlock failed, continuing anyway for recording");
      }
    }

    // Check capabilities
    const caps = getRecordingCapabilities();
    log("Recording capabilities:", caps);

    if (!caps.canRecord) {
      setVoiceError(caps.errorMessage || "Voice recording is not available.");
      return;
    }

    // Start recording
    log("Starting recording");
    const success = await startRecording({
      onStateChange: (state: RecordingState) => {
        log("Recording state:", state);
        if (state === "recording") {
          setVoiceStatus("recording");
        } else if (state === "transcribing") {
          setVoiceStatus("transcribing");
        } else if (state === "done" || state === "idle" || state === "error") {
          // State will be updated by onTranscription or onError
        }
      },
      onError: (message: string) => {
        log("Recording error:", message);
        setVoiceError(message);
        setVoiceStatus("idle");
      },
      onTranscription: (text: string) => {
        log("Transcription received:", text);
        setTranscript(text);
        setVoiceStatus("idle");
        // Send the transcribed message
        doSendMessage(text);
      },
    });

    if (!success) {
      setVoiceStatus("idle");
    }
  }, [voiceStatus, audioUnlocked, handleAudioUnlock]);

  // Send message with streaming response and sentence-based TTS
  const doSendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      log("doSendMessage:", text);

      const currentMsgs = messagesRef.current;
      const userMsg: ChatMessage = { role: "user", text };
      const newMessages = [...currentMsgs, userMsg];
      setMessages(newMessages);
      messagesRef.current = newMessages;
      setTranscript("");
      setIsLoading(true);
      setVoiceStatus("processing");
      setSpeakingMessage(null);

      try {
        const body: any = {
          messages: newMessages.map((m) => ({ role: m.role, text: m.text })),
          profileContext: profile
            ? `User name: ${profile.name}. Hobbies: ${profile.hobbies.join(", ")}. About: ${profile.selfIntro}. Past sessions: ${profile.conversationSummaries.slice(-3).join(" | ")}`
            : "",
          stream: true, // Enable streaming
        };

        const imgSrc = currentImageRef.current || imageRef.current;
        if (imgSrc) {
          body.imageBase64 = imgSrc.split(",")[1];
          body.imageMimeType = imageMimeType;
        }

        const res = await fetch(apiUrl("/api/chat"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }

        // Process streaming response
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let fullText = "";
        let firstSentenceSent = false;
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith("data: ") && !line.includes("[DONE]")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.error) throw new Error(data.error);
                if (data.text) {
                  fullText += data.text;

                  // Check for first complete sentence to start TTS prefetch early
                  if (!firstSentenceSent) {
                    const sentenceMatch = fullText.match(/^(.+?[。！？.!?])/);
                    if (sentenceMatch && fullText.length > 30) {
                      firstSentenceSent = true;
                      log("First sentence detected, prefetching TTS:", sentenceMatch[1].substring(0, 30));
                      // Start prefetching TTS with current text
                      prefetchTTS(fullText);
                      setVoiceStatus("speaking");
                    }
                  }
                }
              } catch (e) {
                // Ignore parse errors
              }
            }
          }
        }

        log("Got full response:", fullText.substring(0, 50) + "...");

        // Prepare the message but don't show yet (wait for TTS to be ready)
        const modelMsg: ChatMessage = { role: "model", text: fullText };
        const updated = [...newMessages, modelMsg];
        messagesRef.current = updated;

        // Stop loading indicator
        setIsLoading(false);

        // Save to backend immediately (but don't display yet)
        saveConversation(updated);

        // Start TTS - show message only when audio is ready to play
        speakWithTranscript(fullText, {
          onStart: () => {
            log("TTS started (preparing)");
            setVoiceStatus("speaking");
          },
          onReadyToSpeak: (text) => {
            log("Ready to speak - now showing message");
            setMessages(updated);  // Show message when audio starts
            setSpeakingMessage(text);
          },
          onEnd: () => {
            log("TTS ended");
            setVoiceStatus("idle");
            setSpeakingMessage(null);
            setSpeakingStatus(null);
          },
          onStatus: (status) => {
            setSpeakingStatus(status);
          },
        }).catch((e) => {
          log("TTS error:", e);
          setMessages(updated);  // Show message on TTS failure
          setVoiceStatus("idle");
        });

        // Store pending edit suggestion for user confirmation (don't auto-trigger)
        const editMatch = fullText.match(/\[EDIT_SUGGESTION:\s*(.*?)\]/);
        if (editMatch && imageRef.current) {
          setPendingEdit(editMatch[1]);
        }
      } catch (err: any) {
        log("Error:", err);
        const errMsg: ChatMessage = { role: "model", text: `Error: ${err.message}` };
        const updated = [...newMessages, errMsg];
        setMessages(updated);
        messagesRef.current = updated;
        setVoiceStatus("idle");
      } finally {
        setIsLoading(false);
      }
    },
    [imageMimeType, profile]
  );

  // Image upload with HEIC support
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // Unlock audio on this user gesture
    if (!audioUnlocked) {
      await handleAudioUnlock();
    }

    const file = e.target.files?.[0];
    if (!file) return;

    let processedFile: Blob = file;
    let mimeType = file.type;

    if (
      file.type === "image/heic" ||
      file.type === "image/heif" ||
      file.name.toLowerCase().endsWith(".heic") ||
      file.name.toLowerCase().endsWith(".heif")
    ) {
      try {
        const heic2any = (await import("heic2any")).default;
        const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
        processedFile = Array.isArray(converted) ? converted[0] : converted;
        mimeType = "image/jpeg";
      } catch (err) {
        console.error("HEIC conversion failed:", err);
        alert("Failed to convert HEIC. Please try JPEG or PNG.");
        return;
      }
    }

    setImageMimeType(mimeType || "image/jpeg");

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      setImage(dataUrl);
      setCurrentImage(dataUrl);
      imageRef.current = dataUrl;
      currentImageRef.current = dataUrl;

      const firstVersion: ImageVersion = { dataUrl, editPrompt: "", timestamp: Date.now() };
      setImageVersions([firstVersion]);
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
          body: JSON.stringify({ imageDataUrl: dataUrl, imageMimeType: mimeType || "image/jpeg" }),
        });
        const data = await res.json();
        setConvoId(data.id);
        convoIdRef.current = data.id;
      } catch (err) {
        console.error("Failed to create conversation:", err);
      }

      setPendingFirstMessage(true);
    };
    reader.readAsDataURL(processedFile);
  };

  // Edit image
  const handleEditImage = async (prompt: string) => {
    if (!prompt.trim() || !imageRef.current || isEditing) return;

    setIsEditing(true);
    try {
      const base64 = (currentImageRef.current || imageRef.current).split(",")[1];
      const res = await fetch(apiUrl("/api/edit-image"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType: imageMimeType,
          editPrompt: prompt,
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const newDataUrl = `data:${data.mimeType};base64,${data.imageBase64}`;
      setCurrentImage(newDataUrl);
      currentImageRef.current = newDataUrl;

      const newVersion: ImageVersion = { dataUrl: newDataUrl, editPrompt: prompt, timestamp: Date.now() };
      const newVersions = [...imageVersionsRef.current, newVersion];
      setImageVersions(newVersions);
      imageVersionsRef.current = newVersions;

      const vNum = newVersions.length - 1;
      const editMsgText = `✨ Created version V${vNum}: "${prompt}". How does it look? Want any other changes?`;

      const editMsg: ChatMessage = { role: "model", text: editMsgText };
      const updated = [...messagesRef.current, editMsg];
      messagesRef.current = updated;

      await speakWithTranscript(editMsgText, {
        onStart: () => setVoiceStatus("speaking"),
        onReadyToSpeak: () => {
          setMessages(updated);
          setSpeakingMessage(editMsgText);
        },
        onEnd: () => {
          setVoiceStatus("idle");
          setSpeakingMessage(null);
          setSpeakingStatus(null);
        },
        onStatus: (status) => setSpeakingStatus(status),
      });

      saveConversation(updated, newVersions);
    } catch (err: any) {
      const errMsg: ChatMessage = {
        role: "model",
        text: `Sorry, I couldn't edit the photo: ${err.message}`,
      };
      const updated = [...messagesRef.current, errMsg];
      setMessages(updated);
      messagesRef.current = updated;
    } finally {
      setIsEditing(false);
    }
  };

  // Stop speaking
  const handleStopSpeaking = useCallback(() => {
    stopSpeaking();
    setVoiceStatus("idle");
    setSpeakingMessage(null);
    setSpeakingStatus(null);
    // Ensure messages are shown
    setMessages(messagesRef.current);
  }, []);

  // End session
  const handleEndSession = async () => {
    handleStopSpeaking();
    cancelRecording();

    if (messages.length < 2) {
      onBack();
      return;
    }

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

    onBack();
  };

  // Loading state
  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-xl">🌙</div>
      </div>
    );
  }

  // Audio unlock prompt overlay
  const AudioPromptOverlay = () => (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-6">
      <div className="bg-gray-900 rounded-2xl p-6 max-w-sm text-center">
        <div className="text-4xl mb-4">🔊</div>
        <h2 className="text-lg font-semibold mb-2">Enable Sound</h2>
        <p className="text-gray-400 text-sm mb-4">
          Tap below to enable voice responses from your recall companion.
        </p>
        <button
          onClick={handleAudioUnlock}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 px-6 rounded-full font-medium transition-colors"
        >
          Enable Sound & Continue
        </button>
        <button
          onClick={() => {
            setShowAudioPrompt(false);
            if (pendingAssistantTextRef.current) {
              const pendingText = pendingAssistantTextRef.current;
              pendingAssistantTextRef.current = null;
              doSendMessage(pendingText);
            }
          }}
          className="mt-3 text-gray-500 text-sm hover:text-gray-400"
        >
          Continue without sound
        </button>
      </div>
    </div>
  );

  // Get mic button appearance based on state
  const getMicButtonStyle = () => {
    switch (voiceStatus) {
      case "recording":
        return "bg-red-600 hover:bg-red-500 animate-pulse";
      case "transcribing":
        return "bg-yellow-600 hover:bg-yellow-500 animate-pulse";
      default:
        return "bg-gray-700 hover:bg-gray-600";
    }
  };

  const getMicButtonIcon = () => {
    switch (voiceStatus) {
      case "recording":
        return "⏹";
      case "transcribing":
        return "⏳";
      default:
        return "🎤";
    }
  };

  // Upload mode — no image yet
  if (!image) {
    return (
      <div className="flex flex-col h-[100dvh]">
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <button onClick={onBack} className="text-sm text-gray-400 hover:text-white">
            ← Back
          </button>
          <h1 className="text-lg font-bold">🌙 New Session</h1>
          <button
            onClick={() => setShowDebug(!showDebug)}
            className="text-xs text-gray-600 hover:text-gray-400"
          >
            🐛
          </button>
        </header>

        <div className="flex-1 flex items-center justify-center p-6">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            onChange={handleImageUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-600 rounded-2xl w-full max-w-sm h-64 flex flex-col items-center justify-center gap-3 hover:border-blue-500 active:bg-gray-900 transition-colors"
          >
            <span className="text-5xl">📷</span>
            <span className="text-gray-400">Upload a photo from today</span>
            <span className="text-gray-600 text-xs">Supports JPEG, PNG, HEIC</span>
          </button>
        </div>

        {showDebug && (
          <div className="px-3 py-2 bg-black/80 text-[10px] font-mono text-gray-400 border-t border-gray-800">
            {getRecorderDebugInfo()} | Audio: {audioUnlocked ? "✓" : "✗"}
          </div>
        )}
      </div>
    );
  }

  // Main voice chat view
  return (
    <div className="flex flex-col h-[100dvh]">
      {showAudioPrompt && <AudioPromptOverlay />}

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0">
        <button onClick={onBack} className="text-sm text-gray-400 hover:text-white">
          ← Back
        </button>
        <div className="flex items-center gap-2">
          {profile?.name && (
            <span className="text-xs text-gray-500">{profile.name}</span>
          )}
          <button
            onClick={() => setShowDebug(!showDebug)}
            className="text-xs text-gray-600 hover:text-gray-400"
          >
            🐛
          </button>
        </div>
        <button
          onClick={handleEndSession}
          className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-full"
        >
          End
        </button>
      </header>

      {/* Photo Area */}
      <div
        className="w-full bg-gray-900 flex items-center justify-center shrink-0 relative"
        style={{ height: "clamp(180px, 35vh, 380px)" }}
      >
        <img
          src={currentImage || image}
          alt="Photo"
          className="max-w-full max-h-full object-contain"
        />
        {isEditing && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="animate-pulse text-lg">✨ Editing...</span>
          </div>
        )}
        {imageVersions.length > 1 && (
          <div className="absolute bottom-2 right-2 flex gap-1.5">
            <button
              onClick={() => setShowHistory(true)}
              className="bg-black/60 backdrop-blur text-xs px-2.5 py-1 rounded-full flex items-center gap-1"
            >
              📸 V{imageVersions.length - 1}
              <span className="text-gray-400">· History</span>
            </button>
          </div>
        )}
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && !isLoading && (
          <div className="text-center text-gray-500 mt-6">
            <div className="animate-pulse">Starting conversation...</div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-blue-600 rounded-br-sm"
                  : "bg-gray-800 rounded-bl-sm"
              }`}
            >
              {msg.text.replace(/\[EDIT_SUGGESTION:.*?\]/g, "").trim()}
              {/* Speaking indicator on current message */}
              {msg.role === "model" && speakingMessage === msg.text && (
                <span className="ml-1 inline-block animate-pulse">🔊</span>
              )}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 px-3 py-2 rounded-2xl text-sm flex items-center gap-2">
              <span className="animate-pulse">Thinking</span>
              <span className="animate-bounce">.</span>
              <span className="animate-bounce" style={{ animationDelay: "0.1s" }}>.</span>
              <span className="animate-bounce" style={{ animationDelay: "0.2s" }}>.</span>
            </div>
          </div>
        )}

        {/* Edit confirmation buttons */}
        {pendingEdit && !isEditing && (
          <div className="flex justify-start">
            <div className="bg-purple-900/50 border border-purple-700 px-3 py-2 rounded-2xl text-sm">
              <div className="text-purple-300 mb-2">
                ✨ Edit suggestion: &ldquo;{pendingEdit}&rdquo;
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    handleEditImage(pendingEdit);
                    setPendingEdit(null);
                  }}
                  className="bg-purple-600 hover:bg-purple-500 px-3 py-1 rounded-full text-xs font-medium transition-colors"
                >
                  Apply Edit
                </button>
                <button
                  onClick={() => setPendingEdit(null)}
                  className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded-full text-xs transition-colors"
                >
                  Skip
                </button>
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Voice Error */}
      {voiceError && (
        <div className="px-3 py-2 bg-red-900/50 border-t border-red-800 text-xs text-red-300">
          ⚠️ {voiceError}
          <button
            onClick={() => setVoiceError(null)}
            className="ml-2 text-red-400 hover:text-red-300"
          >
            ✕
          </button>
        </div>
      )}

      {/* Voice Status */}
      {(transcript || voiceStatus !== "idle" || speakingStatus) && (
        <div className="px-3 py-1.5 border-t border-gray-800 text-xs">
          {transcript && voiceStatus !== "recording" && (
            <div className="text-gray-400 italic mb-1">🎤 &ldquo;{transcript}&rdquo;</div>
          )}
          {voiceStatus === "recording" && (
            <div className="text-red-400 animate-pulse">● Recording... Tap to stop</div>
          )}
          {voiceStatus === "transcribing" && (
            <div className="text-yellow-400">⏳ Transcribing...</div>
          )}
          {voiceStatus === "processing" && (
            <div className="text-yellow-400">⏳ Processing...</div>
          )}
          {voiceStatus === "speaking" && (
            <div className="text-green-400 flex items-center gap-2">
              🔊 {speakingStatus || "Speaking..."}
              <button onClick={handleStopSpeaking} className="text-red-400 hover:text-red-300">
                Stop
              </button>
            </div>
          )}
        </div>
      )}

      {/* Debug panel */}
      {showDebug && (
        <div className="px-3 py-1 bg-black/80 text-[10px] font-mono text-gray-400 border-t border-gray-800">
          {getRecorderDebugInfo()} | Audio: {audioUnlocked ? "✓" : "✗"} | Status: {voiceStatus}
        </div>
      )}

      {/* Input Bar */}
      <div className="border-t border-gray-800 p-3 shrink-0 safe-bottom flex gap-2 items-center">
        <button
          onClick={handleMicPress}
          disabled={isLoading || voiceStatus === "transcribing"}
          className={`w-14 h-14 min-w-[56px] min-h-[56px] rounded-full text-xl flex items-center justify-center transition-all shrink-0 ${getMicButtonStyle()} disabled:opacity-50`}
        >
          {getMicButtonIcon()}
        </button>

        <input
          ref={textInputRef}
          type="text"
          placeholder="Type or speak..."
          className="flex-1 bg-gray-800 rounded-full px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500 min-h-[48px]"
          onKeyDown={async (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!audioUnlocked) {
                await handleAudioUnlock();
              }
              const val = (e.target as HTMLInputElement).value.trim();
              if (val) {
                doSendMessage(val);
                (e.target as HTMLInputElement).value = "";
              }
            }
          }}
        />
      </div>

      {/* Image History Modal */}
      {showHistory && (
        <ImageHistory
          versions={imageVersions}
          onSelect={(v) => setCurrentImage(v.dataUrl)}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}
