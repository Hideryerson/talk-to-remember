"use client";

import { Images, Loader2, MessageSquareText, Pause, Play, X } from "lucide-react";

interface ControlBarProps {
  showTranscript: boolean;
  isPaused: boolean;
  isSaving: boolean;
  onToggleTranscript: () => void;
  onTogglePause: () => void;
  onEndSession: () => void;
  onOpenGallery: () => void;
}

export default function ControlBar({
  showTranscript,
  isPaused,
  isSaving,
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
          className={`glass-button disabled:opacity-60 disabled:cursor-not-allowed ${showTranscript ? "active" : ""}`}
          aria-label={showTranscript ? "Hide transcript" : "Show transcript"}
          disabled={isSaving}
        >
          <MessageSquareText size={22} strokeWidth={2} />
        </button>

        {/* Pause / Resume */}
        <button
          onClick={onTogglePause}
          className={`glass-button disabled:opacity-60 disabled:cursor-not-allowed ${isPaused ? "active" : ""}`}
          aria-label={isPaused ? "Resume conversation" : "Pause conversation"}
          disabled={isSaving}
        >
          {isPaused ? <Play size={22} strokeWidth={2.2} /> : <Pause size={22} strokeWidth={2.2} />}
        </button>

        {/* End Session */}
        <button
          onClick={onEndSession}
          className="glass-button danger disabled:opacity-60 disabled:cursor-not-allowed"
          aria-label="End session"
          disabled={isSaving}
        >
          {isSaving ? <Loader2 size={22} strokeWidth={2.2} className="animate-spin" /> : <X size={22} strokeWidth={2.2} />}
        </button>

        {/* Version Gallery */}
        <button
          onClick={onOpenGallery}
          className="glass-button disabled:opacity-60 disabled:cursor-not-allowed"
          aria-label="Photo versions"
          disabled={isSaving}
        >
          <Images size={22} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
