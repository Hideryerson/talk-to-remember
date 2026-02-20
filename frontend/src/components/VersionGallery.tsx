"use client";

import { useState } from "react";

interface ImageVersion {
  dataUrl: string;
  editPrompt: string;
  timestamp: number;
}

interface VersionGalleryProps {
  versions: ImageVersion[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onClose: () => void;
  onUseVersion?: (index: number) => void; // Callback when user confirms using a version
}

// SF Symbols style icons
const SFSymbols = {
  // xmark - Close
  xmark: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  // chevron.left - Back
  chevronLeft: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  // checkmark.circle.fill - Selected
  checkmarkCircle: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#007aff">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12l3 3 5-6" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

export default function VersionGallery({
  versions,
  currentIndex,
  onSelect,
  onClose,
  onUseVersion,
}: VersionGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState(currentIndex);
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);

  const handleSelect = (index: number) => {
    setSelectedIndex(index);
  };

  const handleThumbnailDoubleClick = (index: number) => {
    setFullscreenIndex(index);
  };

  const handleFullscreenClose = () => {
    setFullscreenIndex(null);
  };

  const handleCloseGallery = () => {
    setFullscreenIndex(null);
    onClose();
  };

  const handleUseThisVersion = () => {
    if (fullscreenIndex !== null) {
      onSelect(fullscreenIndex);
      setFullscreenIndex(null);
      onClose(); // Close gallery and return to conversation
      // Trigger callback to let AI know we're using this version
      if (onUseVersion) {
        onUseVersion(fullscreenIndex);
      }
    }
  };

  // Fullscreen view of a specific version - white semi-transparent style
  if (fullscreenIndex !== null) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md">
        {/* Fullscreen image */}
        <img
          src={versions[fullscreenIndex]?.dataUrl}
          alt={`Version ${fullscreenIndex}`}
          className="w-full h-full object-contain"
        />

        {/* Top bar - white semi-transparent */}
        <div className="absolute top-0 left-0 right-0 safe-top">
          <div className="flex items-center justify-between px-4 py-4">
            <button
              onClick={handleFullscreenClose}
              className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center text-white active:scale-95 transition-transform"
              aria-label="Back to gallery"
              type="button"
            >
              {SFSymbols.chevronLeft}
            </button>
            <span className="text-white font-medium bg-white/20 backdrop-blur-sm px-4 py-1.5 rounded-full">
              {fullscreenIndex === 0 ? "Original" : `Version ${fullscreenIndex}`}
            </span>
            <button
              onClick={handleCloseGallery}
              className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center text-white active:scale-95 transition-transform"
              aria-label="Close gallery"
              type="button"
            >
              {SFSymbols.xmark}
            </button>
          </div>
        </div>

        {/* Bottom bar - white semi-transparent */}
        <div className="absolute bottom-0 left-0 right-0 safe-bottom">
          <div className="bg-white/90 backdrop-blur-md mx-4 mb-4 p-4 rounded-2xl border border-white/50">
            {versions[fullscreenIndex]?.editPrompt && (
              <p className="text-[#1d1d1f]/80 text-sm text-center mb-3">
                &ldquo;{versions[fullscreenIndex].editPrompt}&rdquo;
              </p>
            )}
            <button
              onClick={handleUseThisVersion}
              className="w-full py-3 bg-[#007aff] text-white font-semibold rounded-xl active:scale-[0.98] transition-transform"
            >
              Use This Version
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-white/95 backdrop-blur-md">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 safe-top">
        <div className="flex items-center justify-between px-4 py-4">
          <h2 className="text-lg font-semibold text-[#1d1d1f]">Photo Versions</h2>
          <button
            onClick={handleCloseGallery}
            className="w-10 h-10 rounded-full border border-[#86868b] flex items-center justify-center text-[#1d1d1f] active:scale-95 transition-transform"
            aria-label="Back to conversation"
            type="button"
          >
            {SFSymbols.xmark}
          </button>
        </div>
      </div>

      {/* Main preview */}
      <div className="absolute inset-0 flex items-center justify-center pt-20 pb-48">
        <div className="relative w-full h-full max-w-lg mx-4">
          <img
            src={versions[selectedIndex]?.dataUrl}
            alt={`Version ${selectedIndex}`}
            className="w-full h-full object-contain"
          />
          {versions[selectedIndex]?.editPrompt && (
            <div className="absolute bottom-4 left-4 right-4">
              <div className="bg-white/90 backdrop-blur-sm px-4 py-3 rounded-xl text-sm text-center text-[#1d1d1f] border border-black/5">
                &ldquo;{versions[selectedIndex].editPrompt}&rdquo;
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Thumbnail strip */}
      <div className="absolute bottom-0 left-0 right-0 safe-bottom">
        <div className="bg-white/90 backdrop-blur-md px-4 py-4 mx-4 mb-4 rounded-2xl border border-black/5 shadow-lg">
          <p className="text-xs text-[#86868b] mb-3 text-center">
            Double-tap to change the photo in conversation
          </p>
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
            {versions.map((version, index) => (
              <button
                key={index}
                onClick={() => handleSelect(index)}
                onDoubleClick={() => handleThumbnailDoubleClick(index)}
                type="button"
                className={`relative shrink-0 w-20 h-20 rounded-xl overflow-hidden border-2 transition-all ${
                  index === selectedIndex
                    ? "border-[#007aff] shadow-md"
                    : "border-transparent"
                }`}
              >
                <img
                  src={version.dataUrl}
                  alt={`Version ${index}`}
                  className="w-full h-full object-cover"
                />
                {/* Version label */}
                <div className="absolute bottom-1 left-1 bg-black/60 px-1.5 py-0.5 rounded text-[10px] text-white">
                  {index === 0 ? "Original" : `V${index}`}
                </div>
                {/* Selected indicator */}
                {index === selectedIndex && (
                  <div className="absolute top-1 right-1">
                    {SFSymbols.checkmarkCircle}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
