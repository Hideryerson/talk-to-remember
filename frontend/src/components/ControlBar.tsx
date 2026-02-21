"use client";

import { Images, MessageSquareText, Pause, Play, X } from "lucide-react";

interface ControlBarProps {
  showTranscript: boolean;
  isPaused: boolean;
  onToggleTranscript: () => void;
  onTogglePause: () => void;
  onEndSession: () => void;
  onOpenGallery: () => void;
}

export default function ControlBar({
  showTranscript,
  isPaused,
  onToggleTranscript,
  onTogglePause,
  onEndSession,
  onOpenGallery,
}: ControlBarProps) {
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

        {/* Pause / Resume */}
        <button
          onClick={onTogglePause}
          className={`glass-button ${isPaused ? "active" : ""}`}
          aria-label={isPaused ? "Resume conversation" : "Pause conversation"}
        >
          {isPaused ? <Play size={22} strokeWidth={2.2} /> : <Pause size={22} strokeWidth={2.2} />}
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
    </div>
  );
}
