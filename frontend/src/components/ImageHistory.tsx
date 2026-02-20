"use client";

import type { ImageVersion } from "@/lib/types";

interface ImageHistoryProps {
  versions: ImageVersion[];
  onSelect: (version: ImageVersion) => void;
  onClose: () => void;
}

export default function ImageHistory({ versions, onSelect, onClose }: ImageHistoryProps) {
  if (versions.length === 0) return null;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <h2 className="text-lg font-bold">📸 Edit History ({versions.length})</h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white text-2xl leading-none"
        >
          ✕
        </button>
      </div>

      {/* Versions grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-3">
          {versions.map((v, i) => (
            <button
              key={i}
              onClick={() => {
                onSelect(v);
                onClose();
              }}
              className="text-left bg-gray-900 rounded-xl overflow-hidden hover:ring-2 hover:ring-blue-500 transition-all"
            >
              <img
                src={v.dataUrl}
                alt={v.editPrompt || "Original"}
                className="w-full aspect-video object-contain bg-gray-900"
              />
              <div className="p-2">
                <p className="text-xs text-gray-400">
                  {i === 0 ? "V0 · Original" : `V${i}`}
                </p>
                <p className="text-xs text-gray-300 truncate">
                  {v.editPrompt || "Uploaded photo"}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {new Date(v.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
