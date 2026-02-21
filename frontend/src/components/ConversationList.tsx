"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { getToken, clearToken } from "@/lib/auth";
import { apiUrl } from "@/lib/api";
import { ChevronRight, Image as ImageIcon, LogOut, MessageCircle, Pencil, Trash2 } from "lucide-react";

interface ConvoSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  versionCount: number;
  preview: string;
  hasImage: boolean;
  thumbnailDataUrl?: string | null;
  name?: string;
}

interface Props {
  onSelect: (id: string) => void;
  onNew: () => void;
  greetingName?: string;
}

export default function ConversationList({ onSelect, onNew, greetingName }: Props) {
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

  const defaultConversationNames = useMemo(() => {
    const sortedByCreatedAt = [...conversations].sort((a, b) => {
      const left = new Date(a.createdAt).getTime();
      const right = new Date(b.createdAt).getTime();
      return left - right;
    });
    const nameMap = new Map<string, string>();
    sortedByCreatedAt.forEach((conversation, index) => {
      nameMap.set(conversation.id, `Conversation ${index + 1}`);
    });
    return nameMap;
  }, [conversations]);

  const getDisplayName = (c: ConvoSummary) => {
    if (typeof c.name === "string" && c.name.trim()) return c.name.trim();
    return defaultConversationNames.get(c.id) || "Conversation";
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

  const handleStartRename = (c: ConvoSummary) => {
    setEditName(getDisplayName(c));
    setEditingId(c.id);
    setSwipedId(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f7f7f8] flex items-center justify-center">
        <div className="w-10 h-10 border-3 border-[#007aff] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-[100dvh] overflow-hidden bg-[#f7f7f8] flex flex-col max-w-lg mx-auto relative">
      {/* Header - Fixed */}
      <header className="flex-shrink-0 z-10 bg-white/90 backdrop-blur-md border-b border-gray-200 px-4 py-4 safe-top sticky top-0">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight text-[#1d1d1f]">
            {`Hi, ${(greetingName || "").trim() || "there"}`}
          </h1>
          <button
            onClick={handleLogout}
            className="p-2 rounded-full hover:bg-gray-100 text-[#86868b] transition-colors"
            aria-label="Logout"
          >
            <LogOut size={18} strokeWidth={2} />
          </button>
        </div>
      </header>

      {/* List - Scrollable */}
      <div className="flex-1 overflow-y-auto w-full p-4 space-y-3 pb-8">
        {conversations.map((c) => (
          <div
            key={c.id}
            className="relative overflow-hidden rounded-2xl"
            onTouchStart={handleTouchStart}
            onTouchMove={(e) => handleTouchMove(e, c.id)}
            onTouchEnd={(e) => handleTouchEnd(e, c.id)}
          >
            {/* Swipe actions (revealed on swipe) */}
            <div
              className={`absolute right-0 top-0 bottom-0 flex items-center transition-all duration-200 ${swipedId === c.id ? "w-40" : "w-0"
                } overflow-hidden`}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleStartRename(c);
                }}
                className="w-20 h-full bg-[#007aff] hover:bg-[#0066d6] flex items-center justify-center text-white"
                aria-label="Rename conversation"
              >
                <Pencil size={16} strokeWidth={2} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteConfirmId(c.id);
                }}
                className="w-20 h-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white"
                aria-label="Delete conversation"
              >
                <Trash2 size={16} strokeWidth={2} />
              </button>
            </div>

            {/* Conversation card - ChatGPT style */}
            <div
              onClick={() => handleCardClick(c)}
              className={`bg-white hover:bg-gray-50 p-4 transition-all duration-200 cursor-pointer shadow-sm ${swipedId === c.id ? "-translate-x-40" : "translate-x-0"
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
                  {/* Thumbnail */}
                  <div className="w-12 h-12 rounded-xl overflow-hidden bg-[#f2f2f7] border border-black/5 shrink-0">
                    {c.thumbnailDataUrl ? (
                      <img
                        src={c.thumbnailDataUrl}
                        alt={getDisplayName(c)}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#86868b]">
                        {c.hasImage ? <ImageIcon size={18} strokeWidth={2} /> : <MessageCircle size={18} strokeWidth={2} />}
                      </div>
                    )}
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
                        <span className="ml-1">· {c.versionCount - 1} edits</span>
                      )}
                    </p>
                  </div>

                  {/* Arrow and actions */}
                  <div className="flex items-center">
                    <span className="text-[#c7c7cc]">
                      <ChevronRight size={16} strokeWidth={2} />
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
              <ImageIcon size={24} strokeWidth={2} />
            </div>
            <p className="text-lg font-medium text-[#1d1d1f]">No conversations yet</p>
            <p className="text-sm mt-1">Start a new recall session!</p>
          </div>
        )}
      </div>

      {/* New Chat Button - Fixed */}
      <div className="flex-shrink-0 z-10 sticky bottom-0 bg-white/90 backdrop-blur-md border-t border-gray-200 p-4 safe-bottom">
        <button
          onClick={onNew}
          className="w-full bg-[#007aff] hover:bg-[#0066d6] active:bg-[#0055b3] py-3.5 rounded-xl font-semibold text-white transition-colors"
        >
          New Conversation
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
