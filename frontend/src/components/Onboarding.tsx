"use client";

import { useState, useEffect, useCallback } from "react";
import { getToken } from "@/lib/auth";
import { apiUrl } from "@/lib/api";
import { loadVoices, speakText } from "@/lib/voices";

interface OnboardingProps {
  onComplete: () => void;
}

interface QA {
  question: string;
  answer: string;
  field: string;
}

const STEPS: { question: string; field: string }[] = [
  {
    question:
      "Hi there! 👋 I'm your Daily Recall companion. I'll help you revisit your day through photos and conversation. I'd love to get to know you a bit first! What's your name?",
    field: "name",
  },
  {
    question: "Nice to meet you! Can you tell me a bit about yourself?",
    field: "selfIntro",
  },
  {
    question: "What are some hobbies or things you enjoy doing?",
    field: "hobbies",
  },
  {
    question:
      "What kind of photos do you usually take? (e.g., food, nature, friends, travel...)",
    field: "preferences.photoTypes",
  },
];

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<QA[]>([]);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadVoices().then(() => {
      speakText(STEPS[0].question);
    });
  }, []);

  const handleNext = useCallback(async () => {
    if (!input.trim()) return;

    const currentStep = STEPS[step];
    const newAnswers = [...answers, { question: currentStep.question, answer: input.trim(), field: currentStep.field }];
    setAnswers(newAnswers);
    setInput("");

    if (step + 1 < STEPS.length) {
      const nextQ = STEPS[step + 1].question;
      setStep(step + 1);
      setTimeout(() => speakText(nextQ), 300);
    } else {
      // Save profile
      setSaving(true);
      const profile: any = { onboardingComplete: true };

      for (const qa of newAnswers) {
        if (qa.field === "name") profile.name = qa.answer;
        else if (qa.field === "selfIntro") profile.selfIntro = qa.answer;
        else if (qa.field === "hobbies") profile.hobbies = qa.answer.split(/[,，、\s]+/).filter(Boolean);
        else if (qa.field.startsWith("preferences.")) {
          const key = qa.field.split(".")[1];
          profile.preferences = { ...profile.preferences, [key]: qa.answer };
        }
      }

      try {
        await fetch(apiUrl("/api/profile"), {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify(profile),
        });

        speakText("Great! I'm all set. Let's start recalling your day! 🌟", undefined, () => {
          onComplete();
        });

        setTimeout(onComplete, 3000);
      } catch (err) {
        console.error("Failed to save profile:", err);
        onComplete();
      }
    }
  }, [input, step, answers, onComplete]);

  const currentQ = step < STEPS.length ? STEPS[step].question : "All done! Let's get started 🌟";

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center mb-4">
          <h1 className="text-2xl font-bold">🌙 Getting to know you</h1>
          <p className="text-gray-400 text-sm mt-1">
            Step {Math.min(step + 1, STEPS.length)} of {STEPS.length}
          </p>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-gray-800 rounded-full h-1.5">
          <div
            className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${((step + (saving ? 1 : 0)) / STEPS.length) * 100}%` }}
          />
        </div>

        {/* Previous answers */}
        <div className="space-y-3 max-h-60 overflow-y-auto">
          {answers.map((qa, i) => (
            <div key={i} className="space-y-1">
              <div className="bg-gray-800 rounded-xl px-3 py-2 text-sm text-gray-300">
                {qa.question}
              </div>
              <div className="bg-blue-600 rounded-xl px-3 py-2 text-sm ml-8">
                {qa.answer}
              </div>
            </div>
          ))}
        </div>

        {/* Current question */}
        {!saving && (
          <>
            <div className="bg-gray-800 rounded-xl px-4 py-3 text-sm">
              {currentQ}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleNext()}
                placeholder="Type your answer..."
                className="flex-1 bg-gray-800 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              <button
                onClick={handleNext}
                disabled={!input.trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-6 py-3 rounded-xl font-medium"
              >
                Next
              </button>
            </div>
          </>
        )}

        {saving && (
          <div className="text-center text-gray-400 animate-pulse">
            Setting up your profile...
          </div>
        )}
      </div>
    </div>
  );
}
