"use client";

import { useState, useEffect, useMemo } from "react";
import { setToken, getToken } from "@/lib/auth";
import { apiUrl } from "@/lib/api";
import { loadVoices, speakText } from "@/lib/voices";

interface OnboardingProps {
  onComplete: () => void;
  onBackToAuth: () => void;
  pendingCredentials?: { username: string; password: string } | null;
}

type StepField = "name" | "selfIntro" | "hobbies" | "photoTypes";

interface StepConfig {
  field: StepField;
  title: string;
  prompt: string;
  placeholder: string;
  multiline?: boolean;
}

interface FormValues {
  name: string;
  selfIntro: string;
  hobbies: string;
  photoTypes: string;
}

const STEPS: StepConfig[] = [
  {
    field: "name",
    title: "Your name",
    prompt: "What should I call you?",
    placeholder: "Enter your name",
  },
  {
    field: "selfIntro",
    title: "About you",
    prompt: "How would you describe yourself in one or two sentences?",
    placeholder: "Share a short introduction",
    multiline: true,
  },
  {
    field: "hobbies",
    title: "Interests",
    prompt: "What are your hobbies or activities you enjoy?",
    placeholder: "For example: hiking, coffee, photography",
  },
  {
    field: "photoTypes",
    title: "Photo style",
    prompt: "What kinds of photos do you usually take?",
    placeholder: "For example: food, travel, friends, nature",
  },
];

function toFriendlySaveError(message: string) {
  if (/abort|timeout/i.test(message)) {
    return "Saving took too long. Please check your network and try again.";
  }
  if (/failed to fetch|load failed|network/i.test(message)) {
    return "Cannot reach backend right now. Please retry in a moment.";
  }
  return message;
}

export default function Onboarding({ onComplete, onBackToAuth, pendingCredentials }: OnboardingProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [values, setValues] = useState<FormValues>({
    name: "",
    selfIntro: "",
    hobbies: "",
    photoTypes: "",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const currentStep = STEPS[stepIndex];
  const currentValue = values[currentStep.field];
  const isLastStep = stepIndex === STEPS.length - 1;
  const canProceed = currentValue.trim().length > 0 && !saving;

  useEffect(() => {
    void loadVoices();
  }, []);

  useEffect(() => {
    if (!saving) {
      speakText(currentStep.prompt);
    }
  }, [currentStep, saving]);

  const progressWidth = useMemo(
    () => `${((stepIndex + 1) / STEPS.length) * 100}%`,
    [stepIndex]
  );

  const updateCurrentValue = (nextValue: string) => {
    setValues((prev) => ({ ...prev, [currentStep.field]: nextValue }));
    if (saveError) setSaveError("");
  };

  const submitProfile = async () => {
    const token = getToken();
    if (!token) {
      setSaveError("Session expired. Please log in again.");
      return;
    }

    setSaving(true);
    setSaveError("");

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 12000);

    const profile = {
      onboardingComplete: true,
      name: values.name.trim(),
      selfIntro: values.selfIntro.trim(),
      hobbies: values.hobbies
        .split(/[,，、\s]+/)
        .map((item) => item.trim())
        .filter(Boolean),
      preferences: {
        photoTypes: values.photoTypes.trim(),
      },
    };

    try {
      if (pendingCredentials) {
        // Deferred Single-Step Registration Fusion
        const res = await fetch(apiUrl("/api/auth"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "register",
            username: pendingCredentials.username,
            password: pendingCredentials.password,
            profile,
          }),
          signal: controller.signal,
        });

        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(payload?.error || `Registration failed (${res.status})`);
        }

        if (payload?.token) {
          setToken(payload.token);
        } else {
          throw new Error("Invalid registration response");
        }
      } else {
        // Standard profile update for existing users
        const res = await fetch(apiUrl("/api/profile"), {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(profile),
          signal: controller.signal,
        });

        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(payload?.error || `Save failed (${res.status})`);
        }
      }

      speakText("Great. Your profile is ready.");
      onComplete();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Save failed";
      setSaveError(toFriendlySaveError(message));
    } finally {
      window.clearTimeout(timeoutId);
      setSaving(false);
    }
  };

  const handleNext = async () => {
    if (!canProceed) return;

    if (isLastStep) {
      await submitProfile();
      return;
    }

    setStepIndex((prev) => Math.min(prev + 1, STEPS.length - 1));
  };

  const handleBack = () => {
    if (saving) return;
    setSaveError("");
    if (stepIndex === 0) {
      onBackToAuth();
      return;
    }
    setStepIndex((prev) => Math.max(prev - 1, 0));
  };

  return (
    <div className="h-[100dvh] bg-[#f7f7f8] flex flex-col overflow-hidden">
      {/* Sticky Header */}
      <div className="w-full px-4 pt-[max(env(safe-area-inset-top,1.5rem),1.5rem)] pb-4 bg-white/90 backdrop-blur-md border-b border-gray-200 z-10 shrink-0 sticky top-0">
        <div className="max-w-md mx-auto">
          <h1 className="text-xl font-semibold tracking-tight text-[#1d1d1f] text-center">Getting to know you</h1>
          <p className="text-sm text-[#86868b] mt-2 text-center">
            Step {stepIndex + 1} of {STEPS.length}
          </p>
          <div className="mt-4 h-1.5 w-full rounded-full bg-[#ececf0] overflow-hidden">
            <div
              className="h-full bg-[#007aff] transition-all duration-300 rounded-full"
              style={{ width: progressWidth }}
            />
          </div>
        </div>
      </div>

      {/* Scrollable Chat Area */}
      <div className="flex-1 overflow-y-auto px-6 py-2 flex flex-col w-full max-w-md mx-auto">
        <div className="flex flex-col justify-center gap-6 pb-8 min-h-full">
          <h2 className="text-2xl font-semibold text-center mb-6 text-[#1d1d1f]">
            {currentStep.prompt}
          </h2>

          <div className="w-full relative">
            {currentStep.multiline ? (
              <textarea
                value={currentValue}
                onChange={(e) => updateCurrentValue(e.target.value)}
                className="w-full min-h-[140px] bg-black/5 rounded-xl p-4 text-[#1d1d1f] placeholder-[#86868b] outline-none focus:bg-white focus:ring-2 focus:ring-[#007aff] transition-all resize-none"
                autoFocus
              />
            ) : (
              <input
                type="text"
                value={currentValue}
                onChange={(e) => updateCurrentValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleNext();
                  }
                }}
                className="w-full h-14 bg-black/5 rounded-xl px-5 text-[#1d1d1f] placeholder-[#86868b] outline-none focus:bg-white focus:ring-2 focus:ring-[#007aff] transition-all"
                autoFocus
              />
            )}

            {saveError && (
              <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {saveError}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sticky Footer */}
      <div className="w-full px-6 pt-4 pb-[max(env(safe-area-inset-bottom,1rem),1rem)] bg-white/90 backdrop-blur-md border-t border-gray-200 z-10 shrink-0 sticky bottom-0 safe-bottom">
        <div className="max-w-md mx-auto flex gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="flex-1 h-14 rounded-xl bg-black/5 text-[#1d1d1f] font-semibold disabled:opacity-50 transition-colors flex items-center justify-center active:bg-black/10"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => {
              void handleNext();
            }}
            className="flex-1 h-14 rounded-xl bg-[#007aff] text-white font-semibold disabled:opacity-50 transition-colors flex items-center justify-center active:bg-[#0066d6]"
          >
            {saving ? "Saving..." : isLastStep ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
