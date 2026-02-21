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
  isPreparing?: boolean;
  pendingAssistantText?: string;
}

export default function FloatingTranscript({
  messages,
  visible,
  currentlySpeaking,
  isPreparing = false,
  pendingAssistantText = "",
}: FloatingTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const normalizedPending = pendingAssistantText.replace(/\s+/g, " ").trim();

  useEffect(() => {
    if (!visible) return;
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, visible, normalizedPending]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= 56;
  };

  if (!visible) return null;

  if (messages.length === 0) {
    return (
      <div className="fixed bottom-44 left-4 right-4 z-30 safe-bottom transcript-section">
        <div className="transcript-bubble px-4 py-3">
          {normalizedPending ? (
            <div className="flex justify-start">
              <div className="max-w-[85%] px-4 py-2.5 text-sm leading-relaxed message-model">
                {normalizedPending}
              </div>
            </div>
          ) : isPreparing ? (
            <div className="flex items-center gap-2.5 text-[#1d1d1f]">
              <div className="preparing-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <span className="text-sm font-medium">Preparing transcript</span>
            </div>
          ) : (
            <p className="text-sm text-[#86868b]">Transcript will appear here</p>
          )}
        </div>
      </div>
    );
  }

  const renderMessages = [...messages];
  if (normalizedPending) {
    const last = renderMessages[renderMessages.length - 1];
    if (!(last && last.role === "model" && last.text.replace(/\s+/g, " ").trim() === normalizedPending)) {
      renderMessages.push({ role: "model", text: normalizedPending });
    }
  }

  return (
    <div className="fixed bottom-44 left-4 right-4 z-30 safe-bottom transcript-section">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="transcript-bubble p-2 max-h-[48vh] overflow-y-auto no-scrollbar ios-transition touch-pan-y"
      >
        <div className="space-y-3 pb-3">
          {renderMessages.map((msg, i) => (
            <div
              key={`transcript-${messages.length - renderMessages.length + i}`}
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
