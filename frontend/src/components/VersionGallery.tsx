"use client";

import { useState } from "react";
import { CheckCircle2, ChevronLeft, X } from "lucide-react";

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
      <div className="fixed inset-0 z-50 bg-white/95 backdrop-blur-md">
        {/* Fullscreen image */}
        <img
          src={versions[fullscreenIndex]?.dataUrl}
          alt={`Version ${fullscreenIndex}`}
          className="w-full h-full object-contain"
        />

        {/* Top bar - light theme */}
        <div className="absolute top-0 left-0 right-0 safe-top z-30">
          <div className="flex items-center justify-between px-4 py-4">
            <button
              onClick={handleFullscreenClose}
              className="w-10 h-10 rounded-full bg-black/5 backdrop-blur-sm border border-black/10 flex items-center justify-center text-[#1d1d1f] active:scale-95 transition-transform touch-manipulation"
              aria-label="Back to gallery"
              type="button"
            >
              <ChevronLeft size={20} strokeWidth={2.5} />
            </button>
            <span className="text-[#1d1d1f] font-semibold bg-white/80 backdrop-blur-md px-4 py-1.5 rounded-full shadow-sm border border-black/5">
              {fullscreenIndex === 0 ? "Original" : `Version ${fullscreenIndex}`}
            </span>
            <button
              onClick={handleCloseGallery}
              className="w-10 h-10 rounded-full bg-black/5 backdrop-blur-sm border border-black/10 flex items-center justify-center text-[#1d1d1f] active:scale-95 transition-transform touch-manipulation"
              aria-label="Close gallery"
              type="button"
            >
              <X size={20} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* Bottom bar - light theme */}
        <div className="absolute bottom-0 left-0 right-0 safe-bottom z-20">
          <div className="bg-white/95 backdrop-blur-xl mx-4 mb-4 p-4 rounded-3xl border border-black/5 shadow-lg">
            {versions[fullscreenIndex]?.editPrompt && (
              <p className="text-[#86868b] text-sm text-center mb-3">
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
      <div className="absolute top-0 left-0 right-0 safe-top z-30">
        <div className="flex items-center justify-between px-4 py-4">
          <h2 className="text-lg font-semibold text-[#1d1d1f]">Photo Versions</h2>
          <button
            onClick={handleCloseGallery}
            className="w-10 h-10 rounded-full bg-black/5 border border-black/10 flex items-center justify-center text-[#1d1d1f] active:scale-95 transition-transform touch-manipulation"
            aria-label="Back to conversation"
            type="button"
          >
            <X size={20} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* Main preview */}
      <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center pt-20 pb-48">
        <div className="relative w-full h-full max-w-lg mx-4">
          <img
            src={versions[selectedIndex]?.dataUrl}
            alt={`Version ${selectedIndex}`}
            className="w-full h-full object-contain"
          />
          {/* Edit Prompt floating badge */}
          {versions[selectedIndex]?.editPrompt && (
            <div className="absolute bottom-6 left-4 right-4 z-20 flex justify-center pointer-events-none">
              <div className="bg-white/40 backdrop-blur-2xl px-5 py-3 rounded-2xl text-sm font-medium text-[#1d1d1f] border border-white/50 shadow-md max-w-sm text-center">
                &ldquo;{versions[selectedIndex].editPrompt}&rdquo;
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Thumbnail strip */}
      <div className="absolute bottom-0 left-0 right-0 safe-bottom z-20">
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
                className={`relative shrink-0 w-20 h-20 rounded-xl overflow-hidden border-2 transition-all ${index === selectedIndex
                  ? "border-transparent shadow-md"
                  : "border-transparent"
                  }`}
              >
                <img
                  src={version.dataUrl}
                  alt={`Version ${index}`}
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-1 left-1 bg-white/90 px-1.5 py-0.5 rounded text-[10px] font-medium text-[#1d1d1f] shadow-sm">
                  {index === 0 ? "Original" : `V${index}`}
                </div>
                {/* Selected indicator */}
                {index === selectedIndex && (
                  <div className="absolute inset-0 ring-2 ring-inset ring-[#007aff] rounded-xl z-10 pointer-events-none"></div>
                )}
                {index === selectedIndex && (
                  <div className="absolute top-1 right-1 z-20 bg-white rounded-full p-0.5 shadow-sm">
                    <CheckCircle2 size={20} strokeWidth={2.2} className="text-[#007aff] fill-white" />
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
