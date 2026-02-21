/**
 * Cross-platform Audio Recorder
 *
 * Uses MediaRecorder where available (with fallback MIME types for iOS),
 * falls back to AudioWorklet/WebAudio PCM capture when needed.
 */
import { apiUrl } from "@/lib/api";

// ========== DEBUG ==========
const DEBUG = true;
function log(...args: any[]) {
  if (DEBUG) console.log("[AudioRecorder]", ...args);
}
function warn(...args: any[]) {
  if (DEBUG) console.warn("[AudioRecorder]", ...args);
}
function error(...args: any[]) {
  console.error("[AudioRecorder]", ...args);
}

// ========== TYPES ==========
export type RecordingState = "idle" | "recording" | "transcribing" | "done" | "error";

export interface RecordingResult {
  success: boolean;
  text?: string;
  error?: string;
}

export interface RecorderCallbacks {
  onStateChange: (state: RecordingState) => void;
  onError: (message: string) => void;
  onTranscription: (text: string) => void;
}

// ========== STATE ==========
let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let audioStream: MediaStream | null = null;
let currentState: RecordingState = "idle";
let callbacks: RecorderCallbacks | null = null;

// For PCM fallback
let audioContext: AudioContext | null = null;
let audioWorklet: AudioWorkletNode | null = null;
let pcmChunks: Float32Array[] = [];
let processorNode: ScriptProcessorNode | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;

// Recording limits
const MAX_RECORDING_DURATION_MS = 60000; // 60 seconds max
let recordingTimeout: ReturnType<typeof setTimeout> | null = null;

// ========== VAD (Voice Activity Detection) ==========
const VAD_CONFIG = {
  silenceThreshold: 15,       // Energy threshold (0-255), lower = more sensitive
  silenceDuration: 1200,      // How long silence before auto-stop (ms)
  minSpeechDuration: 500,     // Minimum speech before enabling VAD (ms)
  checkInterval: 100,         // How often to check energy (ms)
};

let vadAnalyser: AnalyserNode | null = null;
let vadSourceNode: MediaStreamAudioSourceNode | null = null;
let vadContext: AudioContext | null = null;
let vadCheckInterval: ReturnType<typeof setInterval> | null = null;
let silenceStartTime: number | null = null;
let speechDetected = false;
let recordingStartTime: number = 0;

// ========== CAPABILITY DETECTION ==========

/**
 * Get supported MIME type for MediaRecorder
 */
function getSupportedMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }

  // Priority order - most compatible first
  const mimeTypes = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/wav",
    "audio/mpeg",
    "", // Empty string = browser default
  ];

  for (const mimeType of mimeTypes) {
    try {
      if (mimeType === "" || MediaRecorder.isTypeSupported(mimeType)) {
        log("Supported MIME type:", mimeType || "(browser default)");
        return mimeType;
      }
    } catch (e) {
      // Continue checking
    }
  }

  return null;
}

/**
 * Check if we have microphone capability
 */
export function hasMicrophoneCapability(): boolean {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/**
 * Check recording capabilities and return info
 */
export function getRecordingCapabilities(): {
  canRecord: boolean;
  method: "mediarecorder" | "pcm" | "none";
  mimeType: string | null;
  errorMessage: string | null;
} {
  if (typeof window === "undefined") {
    return {
      canRecord: false,
      method: "none",
      mimeType: null,
      errorMessage: "Server-side rendering",
    };
  }

  if (!hasMicrophoneCapability()) {
    return {
      canRecord: false,
      method: "none",
      mimeType: null,
      errorMessage: "Microphone access is not available in this browser.",
    };
  }

  const mimeType = getSupportedMimeType();

  if (mimeType !== null) {
    return {
      canRecord: true,
      method: "mediarecorder",
      mimeType: mimeType || "audio/webm",
      errorMessage: null,
    };
  }

  // Check for AudioContext as PCM fallback
  const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (AudioCtx) {
    return {
      canRecord: true,
      method: "pcm",
      mimeType: "audio/wav",
      errorMessage: null,
    };
  }

  return {
    canRecord: false,
    method: "none",
    mimeType: null,
    errorMessage: "Audio recording is not supported in this browser.",
  };
}

// ========== PUBLIC API ==========

/**
 * Request microphone permission
 */
export async function requestMicPermission(): Promise<{
  granted: boolean;
  error: string | null;
}> {
  if (!hasMicrophoneCapability()) {
    return {
      granted: false,
      error: "Microphone access is not available in this browser.",
    };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    // Release immediately
    stream.getTracks().forEach((t) => t.stop());
    return { granted: true, error: null };
  } catch (err: any) {
    log("Mic permission error:", err.name, err.message);

    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      return {
        granted: false,
        error: "Microphone permission was denied. Please enable it in your browser settings.",
      };
    }
    if (err.name === "NotFoundError") {
      return {
        granted: false,
        error: "No microphone found. Please connect a microphone.",
      };
    }
    return {
      granted: false,
      error: `Microphone error: ${err.message}`,
    };
  }
}

/**
 * Start recording
 */
export async function startRecording(cbs: RecorderCallbacks): Promise<boolean> {
  callbacks = cbs;

  // Check capabilities
  const caps = getRecordingCapabilities();
  if (!caps.canRecord) {
    callbacks.onError(caps.errorMessage || "Recording not supported");
    return false;
  }

  // Request permission and get stream
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err: any) {
    const errorMsg = getPermissionErrorMessage(err);
    callbacks.onError(errorMsg);
    return false;
  }

  // Start recording based on method
  if (caps.method === "mediarecorder") {
    return startMediaRecorder(caps.mimeType!);
  } else {
    return startPCMRecording();
  }
}

/**
 * Stop recording and transcribe
 */
export async function stopRecording(): Promise<void> {
  log("stopRecording called, state:", currentState);

  if (currentState !== "recording") {
    log("Not recording, ignoring stop");
    return;
  }

  setState("transcribing");

  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    // The onstop handler will call transcribe
  } else if (audioWorklet) {
    // PCM recording
    stopPCMRecording();
    const audioBlob = createWavBlob(pcmChunks, audioContext!.sampleRate);
    await transcribeAudio(audioBlob, "audio/wav");
  }
}

/**
 * Cancel recording without transcribing
 */
export function cancelRecording(): void {
  log("cancelRecording called");
  cleanup();
  setState("idle");
}

/**
 * Get current recording state
 */
export function getRecordingState(): RecordingState {
  return currentState;
}

// ========== INTERNAL ==========

function setState(state: RecordingState) {
  currentState = state;
  callbacks?.onStateChange(state);
}

function getPermissionErrorMessage(err: any): string {
  if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
    return "Microphone permission was denied. Please enable it in your browser settings and try again.";
  }
  if (err.name === "NotFoundError") {
    return "No microphone found. Please connect a microphone and try again.";
  }
  if (err.name === "NotReadableError") {
    return "Microphone is in use by another application. Please close other apps and try again.";
  }
  return `Microphone error: ${err.message}`;
}

function startMediaRecorder(mimeType: string): boolean {
  audioChunks = [];

  try {
    const options: MediaRecorderOptions = {};
    if (mimeType) {
      options.mimeType = mimeType;
    }

    mediaRecorder = new MediaRecorder(audioStream!, options);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        audioChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = async () => {
      log("MediaRecorder stopped, chunks:", audioChunks.length);
      const audioBlob = new Blob(audioChunks, { type: mimeType || "audio/webm" });
      log("Audio blob size:", audioBlob.size);
      await transcribeAudio(audioBlob, mimeType || "audio/webm");
    };

    mediaRecorder.onerror = (e: any) => {
      error("MediaRecorder error:", e);
      callbacks?.onError("Recording failed. Please try again.");
      cleanup();
      setState("error");
    };

    mediaRecorder.start(100); // Collect data every 100ms
    setState("recording");
    recordingStartTime = Date.now();
    log("MediaRecorder started with mimeType:", mimeType);

    // Setup VAD for auto-stop
    setupVAD();

    // Auto-stop after max duration
    recordingTimeout = setTimeout(() => {
      log("Max recording duration reached, auto-stopping");
      if (currentState === "recording") {
        stopRecording();
      }
    }, MAX_RECORDING_DURATION_MS);

    return true;
  } catch (err: any) {
    error("Failed to start MediaRecorder:", err);
    callbacks?.onError("Failed to start recording. Please try again.");
    cleanup();
    return false;
  }
}

// ========== VAD Functions ==========

function setupVAD(): void {
  if (!audioStream) return;

  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    const context: AudioContext = new AudioCtx();
    vadContext = context;
    setupVADWithContext(context, audioStream);
  } catch (e) {
    warn("Failed to setup VAD:", e);
  }
}

function setupVADWithContext(ctx: AudioContext, stream: MediaStream): void {
  try {
    vadSourceNode = ctx.createMediaStreamSource(stream);
    vadAnalyser = ctx.createAnalyser();
    vadAnalyser.fftSize = 256;
    vadAnalyser.smoothingTimeConstant = 0.5;

    vadSourceNode.connect(vadAnalyser);

    // Reset VAD state
    silenceStartTime = null;
    speechDetected = false;

    // Start checking for silence
    vadCheckInterval = setInterval(checkVAD, VAD_CONFIG.checkInterval);
    log("VAD started");
  } catch (e) {
    warn("Failed to setup VAD with context:", e);
  }
}

function checkVAD(): void {
  if (!vadAnalyser || currentState !== "recording") return;

  const dataArray = new Uint8Array(vadAnalyser.frequencyBinCount);
  vadAnalyser.getByteFrequencyData(dataArray);

  // Calculate average energy
  const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
  const now = Date.now();
  const recordingDuration = now - recordingStartTime;

  // Check if speech is detected
  if (avg > VAD_CONFIG.silenceThreshold) {
    speechDetected = true;
    silenceStartTime = null;
  } else if (speechDetected && recordingDuration > VAD_CONFIG.minSpeechDuration) {
    // Start tracking silence only after minimum speech duration
    if (silenceStartTime === null) {
      silenceStartTime = now;
    } else if (now - silenceStartTime > VAD_CONFIG.silenceDuration) {
      log("VAD: Silence detected, auto-stopping recording");
      stopRecording();
    }
  }
}

function cleanupVAD(): void {
  if (vadCheckInterval) {
    clearInterval(vadCheckInterval);
    vadCheckInterval = null;
  }
  if (vadSourceNode) {
    try {
      vadSourceNode.disconnect();
    } catch (e) {
      // Ignore
    }
    vadSourceNode = null;
  }
  if (vadAnalyser) {
    try {
      vadAnalyser.disconnect();
    } catch (e) {
      // Ignore
    }
    vadAnalyser = null;
  }
  // Only close vadContext if it's separate from audioContext
  if (vadContext && vadContext !== audioContext && vadContext.state !== "closed") {
    try {
      vadContext.close();
    } catch (e) {
      // Ignore
    }
    vadContext = null;
  }
  silenceStartTime = null;
  speechDetected = false;
}

function startPCMRecording(): boolean {
  pcmChunks = [];

  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    const context: AudioContext = new AudioCtx();
    audioContext = context;

    sourceNode = context.createMediaStreamSource(audioStream!);

    // Use ScriptProcessor for broader compatibility (AudioWorklet has issues on some browsers)
    processorNode = context.createScriptProcessor(4096, 1, 1);

    processorNode.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      // Copy the data to avoid memory issues
      pcmChunks.push(new Float32Array(inputData));
    };

    sourceNode.connect(processorNode);
    processorNode.connect(context.destination);

    setState("recording");
    recordingStartTime = Date.now();
    log("PCM recording started");

    // Setup VAD for auto-stop (use existing audioContext)
    setupVADWithContext(context, audioStream!);

    // Auto-stop after max duration
    recordingTimeout = setTimeout(() => {
      log("Max recording duration reached, auto-stopping");
      if (currentState === "recording") {
        stopRecording();
      }
    }, MAX_RECORDING_DURATION_MS);

    return true;
  } catch (err: any) {
    error("Failed to start PCM recording:", err);
    callbacks?.onError("Failed to start recording. Please try again.");
    cleanup();
    return false;
  }
}

function stopPCMRecording(): void {
  // Disconnect nodes properly
  if (processorNode) {
    try {
      processorNode.disconnect();
    } catch (e) {
      // Ignore
    }
    processorNode = null;
  }
  if (sourceNode) {
    try {
      sourceNode.disconnect();
    } catch (e) {
      // Ignore
    }
    sourceNode = null;
  }
  if (audioContext && audioContext.state !== "closed") {
    audioContext.close();
  }
}

function createWavBlob(chunks: Float32Array[], sampleRate: number): Blob {
  // Calculate total length
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const pcmData = new Float32Array(totalLength);

  let offset = 0;
  for (const chunk of chunks) {
    pcmData.set(chunk, offset);
    offset += chunk.length;
  }

  // Convert to 16-bit PCM
  const buffer = new ArrayBuffer(44 + pcmData.length * 2);
  const view = new DataView(buffer);

  // WAV header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + pcmData.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true); // AudioFormat (PCM)
  view.setUint16(22, 1, true); // NumChannels
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // ByteRate
  view.setUint16(32, 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  writeString(36, "data");
  view.setUint32(40, pcmData.length * 2, true);

  // Write PCM data
  let dataOffset = 44;
  for (let i = 0; i < pcmData.length; i++) {
    const sample = Math.max(-1, Math.min(1, pcmData[i]));
    view.setInt16(dataOffset, sample * 0x7fff, true);
    dataOffset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function transcribeAudio(audioBlob: Blob, mimeType: string): Promise<void> {
  log("Transcribing audio, size:", audioBlob.size, "type:", mimeType);

  if (audioBlob.size < 1000) {
    warn("Audio too short, likely no speech");
    callbacks?.onError("No speech detected. Please try again and speak clearly.");
    cleanup();
    setState("idle");
    return;
  }

  try {
    const formData = new FormData();
    formData.append("audio", audioBlob, "recording");
    formData.append("mimeType", mimeType);

    const response = await fetch(apiUrl("/api/transcribe"), {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    log("Transcription result:", data.text);

    if (!data.text || data.text.trim() === "") {
      callbacks?.onError("No speech detected. Please try again and speak clearly.");
      cleanup();
      setState("idle");
      return;
    }

    callbacks?.onTranscription(data.text.trim());
    cleanup();
    setState("done");
  } catch (err: any) {
    error("Transcription failed:", err);
    callbacks?.onError(`Transcription failed: ${err.message}`);
    cleanup();
    setState("error");
  }
}

function cleanup(): void {
  // Clear recording timeout
  if (recordingTimeout) {
    clearTimeout(recordingTimeout);
    recordingTimeout = null;
  }

  // Cleanup VAD
  cleanupVAD();

  if (audioStream) {
    audioStream.getTracks().forEach((t) => t.stop());
    audioStream = null;
  }
  if (mediaRecorder) {
    if (mediaRecorder.state !== "inactive") {
      try {
        mediaRecorder.stop();
      } catch (e) {
        // Ignore
      }
    }
    mediaRecorder = null;
  }

  // Clean up PCM recording nodes
  if (processorNode) {
    try {
      processorNode.disconnect();
    } catch (e) {
      // Ignore
    }
    processorNode = null;
  }
  if (sourceNode) {
    try {
      sourceNode.disconnect();
    } catch (e) {
      // Ignore
    }
    sourceNode = null;
  }
  if (audioContext && audioContext.state !== "closed") {
    try {
      audioContext.close();
    } catch (e) {
      // Ignore
    }
    audioContext = null;
  }

  audioWorklet = null;
  audioChunks = [];
  pcmChunks = [];
}

/**
 * Debug info for display
 */
export function getRecorderDebugInfo(): string {
  const caps = getRecordingCapabilities();
  return `Rec: ${caps.canRecord ? "✓" : "✗"} (${caps.method}) | MIME: ${caps.mimeType || "none"}`;
}
