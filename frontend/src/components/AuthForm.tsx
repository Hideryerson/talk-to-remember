"use client";

import { useState } from "react";
import { setToken } from "@/lib/auth";
import { apiUrl } from "@/lib/api";

interface AuthFormProps {
  onSuccess: () => void;
}

async function readApiPayload(response: Response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  return { error: text?.slice(0, 220) || `HTTP ${response.status}` };
}

function toFriendlyNetworkError(message: string) {
  if (/load failed|failed to fetch|networkerror/i.test(message)) {
    return "Cannot reach backend. Check NEXT_PUBLIC_BACKEND_URL uses https:// and backend CORS includes this Vercel domain.";
  }
  return message;
}

export default function AuthForm({ onSuccess }: AuthFormProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestRegister, setSuggestRegister] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuggestRegister(false);
    setLoading(true);

    try {
      const response = await fetch(apiUrl("/api/auth"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: isLogin ? "login" : "register",
          username: username.trim(),
          password,
        }),
      });

      const payload = await readApiPayload(response);

      if (!response.ok || payload?.error) {
        if (isLogin && response.status === 401) {
          setSuggestRegister(true);
          throw new Error("No account found for this username/password. Please register first.");
        }

        if (response.status === 404) {
          throw new Error(
            "Auth API not found. Please verify NEXT_PUBLIC_BACKEND_URL points to your Render backend."
          );
        }

        throw new Error(payload?.error || `Request failed (${response.status})`);
      }

      if (!payload?.token) {
        throw new Error("Invalid auth response from server.");
      }

      setToken(payload.token);
      onSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      setError(toFriendlyNetworkError(message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f7f7f8] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-3xl border border-gray-200 shadow-sm p-6">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-[#1d1d1f]">RE</h1>
          <p className="text-sm text-[#86868b] mt-1">Recall the moment. Relive the story.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#6e6e73]">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-[#f7f7f8] border border-gray-200 rounded-xl px-4 py-3 text-[#1d1d1f] placeholder-[#86868b] outline-none focus:border-[#007aff] focus:ring-2 focus:ring-[#007aff]/20"
              placeholder="Enter username"
              autoComplete="username"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#6e6e73]">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[#f7f7f8] border border-gray-200 rounded-xl px-4 py-3 text-[#1d1d1f] placeholder-[#86868b] outline-none focus:border-[#007aff] focus:ring-2 focus:ring-[#007aff]/20"
              placeholder="Enter password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#007aff] hover:bg-[#0066d6] disabled:opacity-60 disabled:cursor-not-allowed py-3 rounded-xl font-semibold text-white transition-colors"
          >
            {loading ? "Please wait..." : isLogin ? "Log In" : "Create Account"}
          </button>
        </form>

        {isLogin && suggestRegister && (
          <button
            onClick={() => {
              setIsLogin(false);
              setError("");
              setSuggestRegister(false);
            }}
            className="w-full mt-3 py-2.5 rounded-xl bg-[#f7f7f8] text-[#007aff] font-medium hover:bg-[#eef5ff] transition-colors"
          >
            No account yet? Register now
          </button>
        )}

        <button
          onClick={() => {
            setIsLogin((prev) => !prev);
            setError("");
            setSuggestRegister(false);
          }}
          className="w-full text-center mt-4 text-[#86868b] text-sm hover:text-[#1d1d1f]"
        >
          {isLogin ? "Don't have an account? Register" : "Already registered? Log in"}
        </button>
      </div>
    </div>
  );
}
