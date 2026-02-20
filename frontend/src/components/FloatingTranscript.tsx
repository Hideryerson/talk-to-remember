"use client";

import { useRef, useEffect } from "react";

interface Message {
  role: "user" | "model";
  text: string;
}

interface FloatingTranscriptProps {
  messages: Message[];
  visible: boolean;
  currentlySpeaking?: string | null;
}

export default function FloatingTranscript({
  messages,
  visible,
  currentlySpeaking,
}: FloatingTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current && visible) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, visible]);

  if (!visible || messages.length === 0) return null;

  // Only show last 3 messages for minimal UI
  const recentMessages = messages.slice(-3);

  return (
    <div className="fixed bottom-32 left-4 right-4 z-30 safe-bottom transcript-section">
      <div
        ref={scrollRef}
        className="p-2 max-h-[40vh] overflow-y-auto no-scrollbar ios-transition"
      >
        <div className="space-y-3">
          {recentMessages.map((msg, i) => (
            <div
              key={messages.length - recentMessages.length + i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "message-user"
                    : "message-model"
                }`}
              >
                {msg.text.replace(/\[EDIT_SUGGESTION:.*?\]/g, "").trim()}
                {msg.role === "model" && currentlySpeaking === msg.text && (
                  <span className="ml-2 inline-block">
                    <span className="w-2 h-2 bg-[var(--success)] rounded-full inline-block animate-pulse" />
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
