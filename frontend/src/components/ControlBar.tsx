"use client";

interface ControlBarProps {
  showTranscript: boolean;
  onToggleTranscript: () => void;
  onEndSession: () => void;
  onOpenGallery: () => void;
  isListening: boolean;
  isSpeaking: boolean;
  listeningLevel: number;
}

// SF Symbols style icons as SVG
const SFSymbols = {
  // text.bubble - Transcript
  textBubble: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" />
      <line x1="8" y1="9" x2="16" y2="9" />
      <line x1="8" y1="13" x2="13" y2="13" />
    </svg>
  ),
  // xmark - Close
  xmark: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  // photo.on.rectangle.angled - Gallery
  photoStack: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.5" y="7.5" width="12" height="9" rx="1.8" />
      <rect x="7.5" y="4.5" width="12" height="9" rx="1.8" />
      <circle cx="12" cy="8.8" r="0.95" fill="currentColor" stroke="none" />
      <path d="M8.2 13l2.2-2.2 1.7 1.7 2.4-2.6 2.8 3.1" />
    </svg>
  ),
  // waveform - Listening indicator
  waveform: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="8" width="2" height="8" rx="1" />
      <rect x="8" y="5" width="2" height="14" rx="1" />
      <rect x="12" y="9" width="2" height="6" rx="1" />
      <rect x="16" y="6" width="2" height="12" rx="1" />
      <rect x="20" y="10" width="2" height="4" rx="1" />
    </svg>
  ),
  // speaker.wave.2.fill - Speaking indicator
  speakerWave: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M15.54 8.46a5 5 0 010 7.07" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M18.36 5.64a9 9 0 010 12.73" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
};

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
          {SFSymbols.textBubble}
        </button>

        {/* End Session */}
        <button
          onClick={onEndSession}
          className="glass-button danger"
          aria-label="End session"
        >
          {SFSymbols.xmark}
        </button>

        {/* Version Gallery */}
        <button
          onClick={onOpenGallery}
          className="glass-button"
          aria-label="Photo versions"
        >
          {SFSymbols.photoStack}
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
