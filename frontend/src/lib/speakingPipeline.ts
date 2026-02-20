/**
 * Speaking Pipeline - Single-Shot TTS Mode
 *
 * Generates ONE TTS request for the full assistant reply and plays it as ONE continuous audio.
 * Transcript appears synchronized with audio playback start.
 */
import { apiUrl } from "@/lib/api";

// ========== DEBUG ==========
const DEBUG = true;
function log(...args: any[]) {
  if (DEBUG) console.log("[Pipeline]", ...args);
}
function warn(...args: any[]) {
  if (DEBUG) console.warn("[Pipeline]", ...args);
}
function error(...args: any[]) {
  console.error("[Pipeline]", ...args);
}

// ========== TYPES ==========
export interface PipelineCallbacks {
  /** Called when audio is ready and playback is about to start - reveal transcript now */
  onReadyToSpeak: (fullText: string) => void;
  /** Called when pipeline starts (preparing audio) */
  onStart: () => void;
  /** Called when pipeline ends (audio finished or error) */
  onEnd: () => void;
  /** Called with status updates */
  onStatus?: (status: string) => void;
}

// ========== STATE ==========
let audioContext: AudioContext | null = null;
let audioUnlocked = false;
let currentSource: AudioBufferSourceNode | null = null;
let isRunning = false;
let shouldAbort = false;
let runLock = false; // Mutex-like lock to prevent concurrent runs

// Pending audio for when unlock happens
let pendingAudio: { base64: string; mimeType: string; text: string; callbacks: PipelineCallbacks } | null = null;

// Prefetch cache for early TTS requests
let prefetchedAudio: { text: string; result: Promise<{ success: boolean; audioBase64?: string; mimeType?: string; error?: string }> } | null = null;

// Configuration
const GEMINI_SAMPLE_RATE = 24000;

// ========== AUDIO CONTEXT ==========
function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;

  if (!audioContext) {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      const context: AudioContext = new AudioCtx({ sampleRate: GEMINI_SAMPLE_RATE });
      audioContext = context;
      log("AudioContext created, sampleRate:", context.sampleRate);
    }
  }
  return audioContext;
}

// ========== PUBLIC API ==========

/**
 * Check if audio is unlocked for autoplay
 */
export function isAudioReady(): boolean {
  return audioUnlocked;
}

/**
 * Unlock audio - MUST be called from user gesture.
 */
export async function unlockAudio(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (audioUnlocked) {
    log("Audio already unlocked");
    return true;
  }

  try {
    log("Unlocking audio...");

    // Web Speech unlock
    if (typeof speechSynthesis !== "undefined") {
      const utterance = new SpeechSynthesisUtterance("");
      utterance.volume = 0;
      utterance.rate = 10;
      speechSynthesis.speak(utterance);
    }

    // AudioContext unlock
    const ctx = getAudioContext();
    if (ctx) {
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      // Play silent oscillator
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.01);

      log("AudioContext state after unlock:", ctx.state);
    }

    audioUnlocked = true;
    log("Audio unlock complete");

    // Play pending audio if any
    if (pendingAudio) {
      log("Playing pending audio");
      const { base64, mimeType, text, callbacks } = pendingAudio;
      pendingAudio = null;
      await playAudioWithCallback(base64, mimeType, text, callbacks);
    }

    return true;
  } catch (e) {
    warn("Audio unlock failed:", e);
    return false;
  }
}

/**
 * Check if pipeline is currently running
 */
export function isSpeaking(): boolean {
  return isRunning;
}

/**
 * Stop any ongoing speech
 */
export function stopSpeaking(): void {
  log("stopSpeaking called");
  shouldAbort = true;

  if (currentSource) {
    try {
      currentSource.stop();
    } catch (e) {
      // Already stopped
    }
    currentSource = null;
  }

  if (typeof speechSynthesis !== "undefined") {
    speechSynthesis.cancel();
  }

  isRunning = false;
  runLock = false;
  pendingAudio = null;
  prefetchedAudio = null;
}

/**
 * Prefetch TTS audio for text that's being streamed.
 * Call this when you have enough text to start TTS generation early.
 */
export function prefetchTTS(text: string): void {
  const cleanText = text.replace(/\[EDIT_SUGGESTION:.*?\]/g, "").trim();
  if (!cleanText || cleanText.length < 10) return;

  // Don't prefetch if already prefetching same text
  if (prefetchedAudio && prefetchedAudio.text === cleanText) return;

  log("Prefetching TTS for:", cleanText.substring(0, 30) + "...");
  prefetchedAudio = {
    text: cleanText,
    result: fetchTTSAudio(cleanText),
  };
}

/**
 * Main entry: speak full text as single audio with synchronized transcript.
 *
 * @param text Full text to speak
 * @param callbacks Callbacks for transcript reveal and status
 */
export async function speakWithTranscript(
  text: string,
  callbacks: PipelineCallbacks
): Promise<void> {
  // Guard against concurrent runs using lock
  if (runLock) {
    warn("Pipeline locked, waiting...");
    // Wait up to 500ms for lock to release
    for (let i = 0; i < 10; i++) {
      await delay(50);
      if (!runLock) break;
    }
    if (runLock) {
      warn("Lock timeout, forcing stop");
      stopSpeaking();
      await delay(100);
    }
  }

  if (isRunning) {
    warn("Pipeline already running, stopping previous");
    stopSpeaking();
    await delay(200); // Increased from 50ms to 200ms for better cleanup
  }

  // Clean text
  const cleanText = text.replace(/\[EDIT_SUGGESTION:.*?\]/g, "").trim();
  if (!cleanText) {
    log("Empty text, skipping");
    callbacks.onEnd();
    return;
  }

  log("Starting single-shot TTS for:", cleanText.substring(0, 50) + "...");
  runLock = true;
  isRunning = true;
  shouldAbort = false;

  callbacks.onStart();
  callbacks.onStatus?.("Preparing audio...");

  try {
    // Check if we have prefetched audio for this text
    let audioResult;
    if (prefetchedAudio && prefetchedAudio.text === cleanText) {
      log("Using prefetched TTS audio");
      audioResult = await prefetchedAudio.result;
      prefetchedAudio = null;
    } else {
      // Fetch TTS audio (single request for full text)
      audioResult = await fetchTTSAudio(cleanText);
    }

    if (shouldAbort) {
      log("Aborted during TTS fetch");
      isRunning = false;
      callbacks.onEnd();
      return;
    }

    if (!audioResult.success || !audioResult.audioBase64) {
      warn("TTS failed:", audioResult.error);
      // Show transcript anyway, fall back to Web Speech
      callbacks.onReadyToSpeak(cleanText);
      callbacks.onStatus?.("Speaking...");

      if (audioUnlocked) {
        await speakWithWebSpeech(cleanText);
      }

      isRunning = false;
      callbacks.onEnd();
      return;
    }

    // Check if audio is unlocked
    if (!audioUnlocked) {
      log("Audio not unlocked, storing as pending");
      pendingAudio = {
        base64: audioResult.audioBase64,
        mimeType: audioResult.mimeType || "audio/L16;rate=24000",
        text: cleanText,
        callbacks,
      };
      // Show transcript anyway
      callbacks.onReadyToSpeak(cleanText);
      callbacks.onStatus?.("Tap to enable sound");
      isRunning = false;
      // Don't call onEnd - will be called after unlock plays audio
      return;
    }

    // Play audio with synchronized transcript reveal
    await playAudioWithCallback(
      audioResult.audioBase64,
      audioResult.mimeType || "audio/L16;rate=24000",
      cleanText,
      callbacks
    );
  } catch (e) {
    error("Pipeline error:", e);
    // Show transcript on error
    callbacks.onReadyToSpeak(cleanText);
  } finally {
    runLock = false;
    if (isRunning) {
      isRunning = false;
      callbacks.onEnd();
    }
  }
}

// ========== INTERNAL ==========

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTTSAudio(text: string): Promise<{
  success: boolean;
  audioBase64?: string;
  mimeType?: string;
  error?: string;
}> {
  try {
    log("Fetching TTS for full text...");

    const res = await fetch(apiUrl("/api/tts"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `HTTP ${res.status}: ${errText}` };
    }

    const data = await res.json();

    if (!data.audioBase64) {
      return { success: false, error: "No audio data returned" };
    }

    log("TTS response received, audio length:", data.audioBase64.length);

    return {
      success: true,
      audioBase64: data.audioBase64,
      mimeType: data.mimeType,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

async function playAudioWithCallback(
  base64: string,
  mimeType: string,
  text: string,
  callbacks: PipelineCallbacks
): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) {
    throw new Error("AudioContext not available");
  }

  if (ctx.state === "suspended") {
    log("Resuming suspended AudioContext");
    await ctx.resume();
  }

  // Decode base64
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Parse sample rate from mimeType
  let sampleRate = GEMINI_SAMPLE_RATE;
  const rateMatch = mimeType?.match(/rate=(\d+)/);
  if (rateMatch) {
    sampleRate = parseInt(rateMatch[1], 10);
  }

  // Convert PCM16 to Float32
  const numSamples = Math.floor(bytes.length / 2);
  const float32Data = new Float32Array(numSamples);
  const dataView = new DataView(bytes.buffer);

  for (let i = 0; i < numSamples; i++) {
    const int16 = dataView.getInt16(i * 2, true);
    float32Data[i] = int16 / 32768;
  }

  log("Playing audio:", numSamples, "samples,", (numSamples / sampleRate).toFixed(2), "s");

  // Create and play buffer
  const audioBuffer = ctx.createBuffer(1, numSamples, sampleRate);
  audioBuffer.copyToChannel(float32Data, 0);

  return new Promise((resolve) => {
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    currentSource = source;

    // Reveal transcript RIGHT when audio starts
    callbacks.onReadyToSpeak(text);
    callbacks.onStatus?.("Speaking...");

    source.onended = () => {
      currentSource = null;
      isRunning = false;
      log("Audio playback complete");
      callbacks.onEnd();
      resolve();
    };

    source.start(0);
    log("Audio playback started");
  });
}

function speakWithWebSpeech(text: string): Promise<void> {
  if (typeof speechSynthesis === "undefined") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
    }

    const isChinese = /[\u4e00-\u9fff]/.test(text);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = isChinese ? "zh-CN" : "en-US";
    utterance.rate = 0.95;
    utterance.volume = 1;

    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();

    speechSynthesis.speak(utterance);
  });
}
