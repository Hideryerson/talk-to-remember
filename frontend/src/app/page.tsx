"use client";

import { useState, useEffect } from "react";
import { isLoggedIn, getToken, setToken } from "@/lib/auth";
import { apiUrl } from "@/lib/api";
import type { UserProfile } from "@/lib/types";
import AuthForm from "@/components/AuthForm";
import Onboarding from "@/components/Onboarding";
import ConversationList from "@/components/ConversationList";
import ImmersiveChat from "@/components/ImmersiveChat";

type AppState = "loading" | "auth" | "onboarding" | "conversations" | "immersive";

export default function Home() {
  const [state, setState] = useState<AppState>("loading");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [currentConvoId, setCurrentConvoId] = useState<string | null>(null);

  useEffect(() => {
    checkState();
  }, []);

  const checkState = async () => {
    if (!isLoggedIn()) {
      setState("auth");
      return;
    }

    try {
      const res = await fetch(apiUrl("/api/profile"), {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) {
        const p = await res.json();
        setProfile(p);
        setState(p.onboardingComplete ? "conversations" : "onboarding");
      } else {
        setState("auth");
      }
    } catch {
      setState("auth");
    }
  };

  if (state === "loading") {
    return (
      <div className="min-h-screen bg-[#f7f7f8] flex items-center justify-center">
        <div className="w-10 h-10 border-[3px] border-[#007aff] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (state === "auth") {
    return <AuthForm onSuccess={checkState} />;
  }

  if (state === "onboarding") {
    return (
      <Onboarding
        onComplete={() => {
          checkState(); // re-fetch profile then go to conversations
        }}
        onBackToAuth={() => {
          setToken("");
          setState("auth");
        }}
      />
    );
  }

  if (state === "conversations") {
    return (
      <ConversationList
        greetingName={profile?.name}
        onSelect={(id) => {
          setCurrentConvoId(id);
          setState("immersive");
        }}
        onNew={() => {
          setCurrentConvoId(null);
          setState("immersive");
        }}
      />
    );
  }

  if (state === "immersive" && profile) {
    return (
      <ImmersiveChat
        conversationId={currentConvoId}
        profile={profile}
        onBack={() => {
          setCurrentConvoId(null);
          setState("conversations");
        }}
      />
    );
  }

  return null;
}
