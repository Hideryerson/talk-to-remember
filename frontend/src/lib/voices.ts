/**
 * Voice/TTS module - backward compatibility wrapper.
 * Re-exports from speakingPipeline for compatibility with older code.
 */

import {
  speakWithTranscript,
  stopSpeaking,
  unlockAudio,
  isAudioReady,
  isSpeaking,
} from "./speakingPipeline";

export { stopSpeaking, unlockAudio, isAudioReady, isSpeaking };

// Cached voices for Web Speech fallback
let cachedVoices: SpeechSynthesisVoice[] = [];

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined" || typeof speechSynthesis === "undefined") {
    return Promise.resolve([]);
  }

  return new Promise((resolve) => {
    const voices = speechSynthesis.getVoices();
    if (voices.length > 0) {
      cachedVoices = voices;
      resolve(voices);
      return;
    }

    speechSynthesis.onvoiceschanged = () => {
      cachedVoices = speechSynthesis.getVoices();
      resolve(cachedVoices);
    };

    setTimeout(() => {
      if (cachedVoices.length === 0) {
        cachedVoices = speechSynthesis.getVoices();
      }
      resolve(cachedVoices);
    }, 2000);
  });
}

export async function speakText(
  text: string,
  onStart?: () => void,
  onEnd?: () => void
): Promise<void> {
  return speakWithTranscript(text, {
    onStart: () => onStart?.(),
    onEnd: () => onEnd?.(),
    onReadyToSpeak: () => {},
  });
}
