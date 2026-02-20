"use client";

import type { ImageVersion } from "@/lib/types";

interface ImageHistoryProps {
  versions: ImageVersion[];
  onSelect: (version: ImageVersion) => void;
  onClose: () => void;
}

const SFSymbols = {
  xmark: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  photoStack: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="4" width="13" height="10" rx="2" />
      <rect x="4" y="8" width="13" height="10" rx="2" />
      <circle cx="9.5" cy="11.5" r="1.1" fill="currentColor" stroke="none" />
      <path d="M4 15.5l3-3 2 2 3-3 5 5" />
    </svg>
  ),
};

export default function ImageHistory({ versions, onSelect, onClose }: ImageHistoryProps) {
  if (versions.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 bg-white/94 backdrop-blur-xl">
      <div className="safe-top flex items-center justify-between px-4 py-4 border-b border-black/10">
        <div className="flex items-center gap-2 text-[#1d1d1f]">
          {SFSymbols.photoStack}
          <h2 className="text-lg font-semibold">Photo History</h2>
          <span className="text-sm text-[#86868b]">({versions.length})</span>
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-black/5 border border-black/10 flex items-center justify-center text-[#1d1d1f] active:scale-95 transition-transform"
          aria-label="Close history"
          type="button"
        >
          {SFSymbols.xmark}
        </button>
      </div>

      <div className="h-[calc(100%-72px)] overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-3 pb-4">
          {versions.map((version, index) => (
            <button
              key={index}
              onClick={() => {
                onSelect(version);
                onClose();
              }}
              className="text-left bg-white rounded-2xl border border-black/10 overflow-hidden shadow-sm active:scale-[0.99] transition-transform"
              type="button"
            >
              <img
                src={version.dataUrl}
                alt={version.editPrompt || "Original"}
                className="w-full aspect-video object-contain bg-[#f7f7f8]"
              />
              <div className="p-2.5">
                <p className="text-xs text-[#86868b]">{index === 0 ? "V0 · Original" : `V${index}`}</p>
                <p className="text-xs text-[#1d1d1f] truncate mt-0.5">
                  {version.editPrompt || "Uploaded photo"}
                </p>
                <p className="text-[11px] text-[#86868b] mt-1">
                  {new Date(version.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
