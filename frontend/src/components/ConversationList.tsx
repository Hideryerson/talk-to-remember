"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getToken, clearToken } from "@/lib/auth";
import { apiUrl } from "@/lib/api";

interface ConvoSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  versionCount: number;
  preview: string;
  hasImage: boolean;
  name?: string;
}

interface Props {
  onSelect: (id: string) => void;
  onNew: () => void;
}

// SF Symbols style icons
const SFSymbols = {
  // plus.circle.fill - New
  plusCircle: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="16" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <line x1="8" y1="12" x2="16" y2="12" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  // gearshape - Settings
  gear: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  ),
  // photo.fill - Photo
  photo: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10.5" r="1.5" fill="white" />
      <path d="M21 19l-5-5-3 3-4-4-6 6" fill="none" stroke="white" strokeWidth="2" />
    </svg>
  ),
  // bubble.left.fill - Chat
  chat: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  // pencil - Edit
  pencil: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  // trash - Delete
  trash: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  ),
  // rectangle.portrait.and.arrow.right - Logout
  logout: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  ),
  // chevron.right - Arrow
  chevronRight: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  ),
};

export default function ConversationList({ onSelect, onNew }: Props) {
  const [conversations, setConversations] = useState<ConvoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [swipedId, setSwipedId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Touch handling for swipe
  const touchStartX = useRef<number>(0);
  const touchCurrentX = useRef<number>(0);
  const swipeThreshold = 80;

  useEffect(() => {
    fetchConversations();
  }, []);

  const fetchConversations = async () => {
    try {
      const res = await fetch(apiUrl("/api/conversations"), {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();

      if (data.length === 0) {
        onNew();
        return;
      }

      setConversations(data);
    } catch (err) {
      console.error("Failed to fetch conversations:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleRename = async (id: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setEditingId(null);
      return;
    }

    // Optimistic update
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, name: trimmed } : c))
    );
    setEditingId(null);

    try {
      await fetch(apiUrl(`/api/conversations/${id}`), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ name: trimmed }),
      });
    } catch (err) {
      console.error("Failed to rename:", err);
      fetchConversations();
    }
  };

  const handleDelete = async (id: string) => {
    // Optimistic removal
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setDeleteConfirmId(null);
    setSwipedId(null);

    try {
      await fetch(apiUrl(`/api/conversations/${id}`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
    } catch (err) {
      console.error("Failed to delete:", err);
      fetchConversations();
    }
  };

  // Touch handlers for swipe-to-delete
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchCurrentX.current = e.touches[0].clientX;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent, id: string) => {
    touchCurrentX.current = e.touches[0].clientX;
    const diff = touchStartX.current - touchCurrentX.current;

    if (diff > 20) {
      setSwipedId(id);
    } else if (diff < -20 && swipedId === id) {
      setSwipedId(null);
    }
  }, [swipedId]);

  const handleTouchEnd = useCallback((e: React.TouchEvent, id: string) => {
    const diff = touchStartX.current - touchCurrentX.current;

    if (diff > swipeThreshold) {
      setSwipedId(id);
    } else if (diff < -swipeThreshold && swipedId === id) {
      setSwipedId(null);
    }
  }, [swipedId]);

  const handleLogout = () => {
    clearToken();
    window.location.reload();
  };

  const getDisplayName = (c: ConvoSummary) => {
    if (c.name) return c.name;
    return new Date(c.createdAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  const handleCardClick = (c: ConvoSummary) => {
    if (swipedId === c.id) {
      setSwipedId(null);
    } else if (editingId !== c.id) {
      onSelect(c.id);
    }
  };

  const handleStartRename = (e: React.MouseEvent, c: ConvoSummary) => {
    e.stopPropagation();
    setEditName(c.name || getDisplayName(c));
    setEditingId(c.id);
  };

  const handleStartDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteConfirmId(id);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f7f7f8] flex items-center justify-center">
        <div className="w-10 h-10 border-3 border-[#007aff] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f7f8] flex flex-col max-w-lg mx-auto">
      {/* Header - ChatGPT style */}
      <header className="bg-white border-b border-gray-200 px-4 py-4 safe-top">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-[#1d1d1f]">Daily Recall</h1>
          <button
            onClick={handleLogout}
            className="p-2 rounded-full hover:bg-gray-100 text-[#86868b] transition-colors"
            aria-label="Logout"
          >
            {SFSymbols.logout}
          </button>
        </div>
      </header>

      {/* List - ChatGPT style cards */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {conversations.map((c) => (
          <div
            key={c.id}
            className="relative overflow-hidden rounded-2xl"
            onTouchStart={handleTouchStart}
            onTouchMove={(e) => handleTouchMove(e, c.id)}
            onTouchEnd={(e) => handleTouchEnd(e, c.id)}
          >
            {/* Delete button (revealed on swipe) */}
            <div
              className={`absolute right-0 top-0 bottom-0 flex items-center transition-all duration-200 ${
                swipedId === c.id ? "w-20" : "w-0"
              } overflow-hidden`}
            >
              <button
                onClick={() => setDeleteConfirmId(c.id)}
                className="w-full h-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white"
              >
                {SFSymbols.trash}
              </button>
            </div>

            {/* Conversation card - ChatGPT style */}
            <div
              onClick={() => handleCardClick(c)}
              className={`bg-white hover:bg-gray-50 p-4 transition-all duration-200 cursor-pointer shadow-sm ${
                swipedId === c.id ? "-translate-x-20" : "translate-x-0"
              }`}
            >
              {editingId === c.id ? (
                // Editing mode
                <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 bg-[#f7f7f8] px-3 py-2 rounded-lg text-sm text-[#1d1d1f] outline-none focus:ring-2 focus:ring-[#007aff]"
                    placeholder="Enter name..."
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleRename(c.id, editName);
                      } else if (e.key === "Escape") {
                        setEditingId(null);
                      }
                    }}
                    onBlur={() => handleRename(c.id, editName)}
                  />
                </div>
              ) : (
                // Normal display
                <div className="flex items-center gap-3">
                  {/* Icon */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    c.hasImage ? "bg-blue-100 text-[#007aff]" : "bg-gray-100 text-[#86868b]"
                  }`}>
                    {c.hasImage ? SFSymbols.photo : SFSymbols.chat}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-base font-medium text-[#1d1d1f] truncate">
                        {getDisplayName(c)}
                      </span>
                      <span className="text-xs text-[#86868b] flex-shrink-0 ml-2">
                        {getRelativeTime(c.updatedAt)}
                      </span>
                    </div>
                    <p className="text-sm text-[#86868b] line-clamp-1">
                      {c.preview || "No messages yet"}
                      {c.messageCount > 0 && (
                        <span className="ml-1">· {c.messageCount} msgs</span>
                      )}
                      {c.versionCount > 1 && (
                        <span className="ml-1">· {c.versionCount} edits</span>
                      )}
                    </p>
                  </div>

                  {/* Arrow and actions */}
                  <div className="flex items-center gap-1">
                    {/* Desktop: Edit/Delete buttons */}
                    <div className="hidden sm:flex gap-1">
                      <button
                        onClick={(e) => handleStartRename(e, c)}
                        className="p-2 rounded-full hover:bg-gray-100 text-[#86868b]"
                        title="Rename"
                      >
                        {SFSymbols.pencil}
                      </button>
                      <button
                        onClick={(e) => handleStartDelete(e, c.id)}
                        className="p-2 rounded-full hover:bg-red-50 text-[#86868b] hover:text-red-500"
                        title="Delete"
                      >
                        {SFSymbols.trash}
                      </button>
                    </div>
                    <span className="text-[#c7c7cc]">
                      {SFSymbols.chevronRight}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {conversations.length === 0 && (
          <div className="text-center text-[#86868b] py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center text-[#007aff]">
              {SFSymbols.photo}
            </div>
            <p className="text-lg font-medium text-[#1d1d1f]">No conversations yet</p>
            <p className="text-sm mt-1">Start a new recall session!</p>
          </div>
        )}
      </div>

      {/* New Chat Button - ChatGPT style */}
      <div className="p-4 safe-bottom bg-white border-t border-gray-200">
        <button
          onClick={onNew}
          className="w-full bg-[#007aff] hover:bg-[#0066d6] active:bg-[#0055b3] py-3.5 rounded-xl font-semibold text-white transition-colors"
        >
          Start New Session
        </button>
      </div>

      {/* Delete Confirmation Modal - ChatGPT style */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h2 className="text-lg font-semibold text-[#1d1d1f] mb-2">Delete Conversation?</h2>
            <p className="text-[#86868b] text-sm mb-6">
              This will permanently delete this conversation and all its messages.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 bg-[#f7f7f8] hover:bg-gray-200 py-3 rounded-xl font-medium text-[#1d1d1f] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                className="flex-1 bg-red-500 hover:bg-red-600 py-3 rounded-xl font-medium text-white transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
