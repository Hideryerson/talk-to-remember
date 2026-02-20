"use client";

import { Images, MessageSquareText, X } from "lucide-react";

interface ControlBarProps {
  showTranscript: boolean;
  onToggleTranscript: () => void;
  onEndSession: () => void;
  onOpenGallery: () => void;
  isListening: boolean;
  isSpeaking: boolean;
  listeningLevel: number;
}

export default function ControlBar({
  showTranscript,
  onToggleTranscript,
  onEndSession,
  onOpenGallery,
  isListening,
  isSpeaking,
  listeningLevel,
}: ControlBarProps) {
  const safeLevel = Math.max(0, Math.min(1, listeningLevel));
  const barMultipliers = [0.55, 0.78, 1, 0.78, 0.55];

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 safe-bottom z-40">
      <div className="control-bar px-4 py-3 flex items-center gap-4">
        {/* Transcript Toggle */}
        <button
          onClick={onToggleTranscript}
          className={`glass-button ${showTranscript ? "active" : ""}`}
          aria-label={showTranscript ? "Hide transcript" : "Show transcript"}
        >
          <MessageSquareText size={22} strokeWidth={2} />
        </button>

        {/* End Session */}
        <button
          onClick={onEndSession}
          className="glass-button danger"
          aria-label="End session"
        >
          <X size={22} strokeWidth={2.2} />
        </button>

        {/* Version Gallery */}
        <button
          onClick={onOpenGallery}
          className="glass-button"
          aria-label="Photo versions"
        >
          <Images size={22} strokeWidth={2} />
        </button>
      </div>

      {/* Status indicator */}
      {(isListening || isSpeaking) && (
        <div className="absolute -top-14 left-1/2 -translate-x-1/2">
          <div className="status-pill flex items-center gap-2">
            {isListening && (
              <>
                <div className="listening-indicator">
                  {barMultipliers.map((multiplier, index) => {
                    const minHeight = 5 + index % 2;
                    const dynamicHeight = Math.round((6 + safeLevel * 14) * multiplier);
                    return (
                      <span
                        key={`mic-level-${index}`}
                        style={{ height: `${Math.max(minHeight, dynamicHeight)}px` }}
                      />
                    );
                  })}
                </div>
                <span className="text-[var(--accent)] font-medium">Listening</span>
              </>
            )}
            {isSpeaking && !isListening && (
              <>
                <div className="w-3 h-3 bg-[var(--success)] rounded-full speaking"></div>
                <span className="text-[var(--success)] font-medium">Speaking</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
