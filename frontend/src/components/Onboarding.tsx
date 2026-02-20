"use client";

import { useEffect, useMemo, useState } from "react";
import { getToken } from "@/lib/auth";
import { apiUrl } from "@/lib/api";
import { loadVoices, speakText } from "@/lib/voices";

interface OnboardingProps {
  onComplete: () => void;
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

export default function Onboarding({ onComplete }: OnboardingProps) {
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
    setStepIndex((prev) => Math.max(prev - 1, 0));
  };

  return (
    <div className="min-h-screen bg-[#f7f7f8] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl border border-gray-200 shadow-sm p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-[#1d1d1f]">Getting to know you</h1>
          <p className="text-sm text-[#86868b] mt-1">
            Step {stepIndex + 1} of {STEPS.length}
          </p>
          <div className="mt-3 h-1.5 w-full rounded-full bg-[#ececf0] overflow-hidden">
            <div
              className="h-full bg-[#007aff] transition-all duration-300 rounded-full"
              style={{ width: progressWidth }}
            />
          </div>
        </div>

        <div className="bg-[#f7f7f8] border border-gray-200 rounded-2xl p-4 mb-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[#86868b]">
            {currentStep.title}
          </p>
          <p className="text-[15px] leading-relaxed text-[#1d1d1f] mt-1">
            {currentStep.prompt}
          </p>
        </div>

        {currentStep.multiline ? (
          <textarea
            value={currentValue}
            onChange={(e) => updateCurrentValue(e.target.value)}
            placeholder={currentStep.placeholder}
            className="w-full min-h-[120px] bg-[#f7f7f8] border border-gray-200 rounded-2xl px-4 py-3 text-[#1d1d1f] placeholder-[#86868b] outline-none focus:border-[#007aff] focus:ring-2 focus:ring-[#007aff]/20 resize-none"
            disabled={saving}
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
            placeholder={currentStep.placeholder}
            className="w-full bg-[#f7f7f8] border border-gray-200 rounded-2xl px-4 py-3 text-[#1d1d1f] placeholder-[#86868b] outline-none focus:border-[#007aff] focus:ring-2 focus:ring-[#007aff]/20"
            disabled={saving}
            autoFocus
          />
        )}

        {saveError && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {saveError}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={handleBack}
            disabled={saving || stepIndex === 0}
            className="flex-1 py-3 rounded-xl bg-[#f2f2f5] text-[#1d1d1f] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => {
              void handleNext();
            }}
            disabled={!canProceed}
            className="flex-1 py-3 rounded-xl bg-[#007aff] text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : isLastStep ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
