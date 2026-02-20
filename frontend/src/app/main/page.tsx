"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { getToken, clearToken } from "@/lib/auth";
import { apiUrl } from "@/lib/api";
import { loadVoices, speakText, stopSpeaking, unlockAudio } from "@/lib/voices";
import { ChatMessage, ImageVersion, UserProfile } from "@/lib/types";
import ImageHistory from "@/components/ImageHistory";

export default function MainPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState("image/jpeg");
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [imageVersions, setImageVersions] = useState<ImageVersion[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [pendingImageUpload, setPendingImageUpload] = useState(false);

  const recognitionRef = useRef<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);

  // Keep messagesRef in sync
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Load voices and profile on mount
  useEffect(() => {
    loadVoices();
    fetchProfile();
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Trigger conversation when a new image is uploaded
  useEffect(() => {
    if (pendingImageUpload && image) {
      setPendingImageUpload(false);
      doSendMessage("I just uploaded a photo from today. What do you see?");
    }
  }, [pendingImageUpload, image]);

  const fetchProfile = async () => {
    try {
      const res = await fetch(apiUrl("/api/profile"), {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) setProfile(await res.json());
    } catch (err) {
      console.error("Failed to fetch profile:", err);
    }
  };

  // Enable audio on first user interaction
  const enableAudio = useCallback(() => {
    if (!audioEnabled) {
      unlockAudio();
      setAudioEnabled(true);
    }
  }, [audioEnabled]);

  // Speech recognition
  const startListening = useCallback(() => {
    enableAudio();
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      alert("Speech recognition not supported. Please use Chrome.");
      return;
    }

    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "";

    recognition.onresult = (e: any) => {
      const result = e.results[e.results.length - 1];
      const text = result[0].transcript;
      setTranscript(text);

      if (result.isFinal) {
        setTimeout(() => doSendMessage(text), 300);
      }
    };

    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [enableAudio]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  // Send message — uses ref to avoid stale closure
  const doSendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      const currentMsgs = messagesRef.current;
      const userMsg: ChatMessage = { role: "user", text };
      const newMessages = [...currentMsgs, userMsg];
      setMessages(newMessages);
      messagesRef.current = newMessages;
      setTranscript("");
      setIsLoading(true);

      try {
        const body: any = {
          messages: newMessages.map((m) => ({ role: m.role, text: m.text })),
          profileContext: profile
            ? `User name: ${profile.name}. Hobbies: ${profile.hobbies.join(", ")}. About: ${profile.selfIntro}. Past sessions: ${profile.conversationSummaries.slice(-3).join(" | ")}`
            : "",
        };

        // Use the latest image from state
        const imgSrc = currentImage || image;
        if (imgSrc) {
          body.imageBase64 = imgSrc.split(",")[1];
          body.imageMimeType = imageMimeType;
        }

        const res = await fetch(apiUrl("/api/chat"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const modelMsg: ChatMessage = { role: "model", text: data.text };
        const updated = [...newMessages, modelMsg];
        setMessages(updated);
        messagesRef.current = updated;

        // Speak response
        speakText(
          data.text,
          () => setIsSpeaking(true),
          () => setIsSpeaking(false)
        );

        // Auto-trigger edit if suggestion found
        const editMatch = data.text.match(/\[EDIT_SUGGESTION:\s*(.*?)\]/);
        if (editMatch && image) {
          handleEditImage(editMatch[1]);
        }
      } catch (err: any) {
        const errMsg: ChatMessage = { role: "model", text: `Error: ${err.message}` };
        const updated = [...newMessages, errMsg];
        setMessages(updated);
        messagesRef.current = updated;
      } finally {
        setIsLoading(false);
      }
    },
    [image, currentImage, imageMimeType, profile]
  );

  // Image upload with HEIC support
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    enableAudio();
    const file = e.target.files?.[0];
    if (!file) return;

    let processedFile: Blob = file;
    let mimeType = file.type;

    // Convert HEIC/HEIF to JPEG
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
        alert("Failed to convert HEIC photo. Please try a JPEG or PNG.");
        return;
      }
    }

    setImageMimeType(mimeType || "image/jpeg");

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setImage(dataUrl);
      setCurrentImage(dataUrl);
      setImageVersions([{ dataUrl, editPrompt: "", timestamp: Date.now() }]);
      // Clear previous conversation for new photo
      setMessages([]);
      messagesRef.current = [];
      setPendingImageUpload(true);
    };
    reader.readAsDataURL(processedFile);
  };

  // Edit image
  const handleEditImage = async (prompt: string) => {
    if (!prompt.trim() || !image || isEditing) return;

    setIsEditing(true);
    try {
      const base64 = (currentImage || image).split(",")[1];
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
      setImageVersions((prev) => [
        ...prev,
        { dataUrl: newDataUrl, editPrompt: prompt, timestamp: Date.now() },
      ]);

      const editMsg: ChatMessage = {
        role: "model",
        text: `Done. I edited the photo: "${prompt}". How does it look?`,
      };
      setMessages((prev) => {
        const updated = [...prev, editMsg];
        messagesRef.current = updated;
        return updated;
      });
      speakText(editMsg.text, () => setIsSpeaking(true), () => setIsSpeaking(false));
    } catch (err: any) {
      const errMsg: ChatMessage = {
        role: "model",
        text: `Sorry, I couldn't edit the photo: ${err.message}`,
      };
      setMessages((prev) => {
        const updated = [...prev, errMsg];
        messagesRef.current = updated;
        return updated;
      });
    } finally {
      setIsEditing(false);
    }
  };

  // End session — update profile
  const handleEndSession = async () => {
    if (messages.length < 2) return;

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
      console.error("Failed to update profile:", err);
    }

    setMessages([]);
    messagesRef.current = [];
    setImage(null);
    setCurrentImage(null);
    setImageVersions([]);
  };

  const handleLogout = () => {
    clearToken();
    window.location.reload();
  };

  return (
    <div className="flex flex-col h-[100dvh] max-w-4xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <div>
          <h1 className="text-lg font-bold">RE</h1>
          {profile?.name && (
            <p className="text-xs text-gray-400">Hi, {profile.name}</p>
          )}
        </div>
        <div className="flex gap-2">
          {messages.length > 0 && (
            <button
              onClick={handleEndSession}
              className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-full"
            >
              End Session
            </button>
          )}
          <button
            onClick={handleLogout}
            className="text-xs text-gray-500 hover:text-white px-2 py-1.5"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Image Panel */}
        <div className="md:w-1/2 p-3 flex flex-col gap-2 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            onChange={handleImageUpload}
            className="hidden"
          />

          {!image ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-600 rounded-xl h-48 md:h-64 flex flex-col items-center justify-center gap-2 hover:border-blue-500 transition-colors active:bg-gray-900"
            >
              <span className="text-sm font-medium text-blue-300">Upload</span>
              <span className="text-gray-400 text-sm">Upload a photo from today</span>
            </button>
          ) : (
            <>
              <div className="relative">
                <img
                  src={currentImage || image}
                  alt="Photo"
                  className="w-full rounded-xl max-h-48 md:max-h-72 object-cover"
                />
                {isEditing && (
                  <div className="absolute inset-0 bg-black/50 rounded-xl flex items-center justify-center">
                    <span className="animate-pulse text-lg">Editing...</span>
                  </div>
                )}
                {imageVersions.length > 1 && (
                  <span className="absolute top-2 left-2 bg-green-600/90 text-xs px-2 py-1 rounded-full">
                    v{imageVersions.length}
                  </span>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg"
                >
                  Change photo
                </button>
                {imageVersions.length > 1 && (
                  <button
                    onClick={() => setShowHistory(true)}
                    className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg"
                  >
                    History ({imageVersions.length})
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Chat Panel */}
        <div className="flex-1 flex flex-col bg-gray-900 md:rounded-xl md:m-3 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.length === 0 && (
              <div className="text-center text-gray-500 mt-8">
                <p className="text-3xl mb-2">—</p>
                <p className="text-sm">Upload a photo to start your recall session</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-xl text-sm ${
                    msg.role === "user"
                      ? "bg-blue-600 rounded-br-sm"
                      : "bg-gray-800 rounded-bl-sm"
                  }`}
                >
                  {msg.text.replace(/\[EDIT_SUGGESTION:.*?\]/g, "").trim()}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-800 px-3 py-2 rounded-xl text-sm animate-pulse">
                  Thinking...
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {transcript && (
            <div className="px-3 py-1 text-xs text-gray-400 italic border-t border-gray-800">
              Mic: &ldquo;{transcript}&rdquo;
            </div>
          )}

          {isSpeaking && (
            <div className="px-3 py-1 text-xs text-gray-400 flex items-center gap-2 border-t border-gray-800">
              <span className="animate-pulse">●</span> Speaking...
              <button
                onClick={() => {
                  stopSpeaking();
                  setIsSpeaking(false);
                }}
                className="text-red-400 hover:text-red-300"
              >
                Stop
              </button>
            </div>
          )}

          <div className="border-t border-gray-800 p-3 flex gap-2 shrink-0">
            <button
              onClick={isListening ? stopListening : startListening}
              className={`min-w-[48px] min-h-[48px] rounded-full text-xs font-medium flex items-center justify-center transition-all ${
                isListening
                  ? "bg-red-600 hover:bg-red-500 animate-pulse"
                  : "bg-gray-700 hover:bg-gray-600"
              }`}
            >
              {isListening ? "Stop" : "Mic"}
            </button>

            <input
              type="text"
              placeholder="Or type here..."
              className="flex-1 bg-gray-800 rounded-full px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500 min-h-[48px]"
              onKeyDown={(e) => {
                enableAudio();
                if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) {
                  doSendMessage((e.target as HTMLInputElement).value);
                  (e.target as HTMLInputElement).value = "";
                }
              }}
            />
          </div>
        </div>
      </div>

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
