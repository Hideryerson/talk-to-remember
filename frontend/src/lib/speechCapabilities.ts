/**
 * Speech Capabilities Detection
 *
 * Properly detects speech recognition support based on actual API availability,
 * NOT browser user-agent sniffing.
 */

// ========== DEBUG ==========
const DEBUG = true;
function log(...args: any[]) {
  if (DEBUG) console.log("[SpeechCaps]", ...args);
}

// ========== TYPES ==========
export interface SpeechCapabilities {
  /** Whether Web Speech Recognition API is available */
  hasSpeechRecognition: boolean;
  /** Whether microphone access is potentially available */
  hasMicrophoneAPI: boolean;
  /** Whether we're on iOS (affects Chrome behavior) */
  isIOS: boolean;
  /** Whether we're using a WebKit-based browser on iOS */
  isIOSWebKit: boolean;
  /** User-friendly error message if speech recognition is unavailable */
  unavailableReason: string | null;
  /** Suggested action for the user */
  suggestedAction: string | null;
}

export interface MicPermissionResult {
  granted: boolean;
  denied: boolean;
  error: string | null;
}

// ========== CACHED CAPABILITIES ==========
let cachedCapabilities: SpeechCapabilities | null = null;

// ========== PUBLIC API ==========

/**
 * Get speech recognition capabilities.
 * Safe to call on server (returns unavailable).
 */
export function getSpeechCapabilities(): SpeechCapabilities {
  if (typeof window === "undefined") {
    return {
      hasSpeechRecognition: false,
      hasMicrophoneAPI: false,
      isIOS: false,
      isIOSWebKit: false,
      unavailableReason: "Server-side rendering",
      suggestedAction: null,
    };
  }

  if (cachedCapabilities) {
    return cachedCapabilities;
  }

  // Detect iOS
  const userAgent = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(userAgent) && !(window as any).MSStream;

  // On iOS, ALL browsers use WebKit (Apple's policy)
  // This means Chrome/Firefox on iOS don't have Web Speech Recognition
  const isIOSWebKit = isIOS;

  // Check for Web Speech Recognition API
  const SpeechRecognition =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const hasSpeechRecognition = !!SpeechRecognition;

  // Check for microphone API
  const hasMicrophoneAPI = !!(
    navigator.mediaDevices && navigator.mediaDevices.getUserMedia
  );

  // Determine unavailable reason and suggested action
  let unavailableReason: string | null = null;
  let suggestedAction: string | null = null;

  if (!hasSpeechRecognition) {
    if (isIOSWebKit) {
      // iOS Chrome/Firefox/Edge all use WebKit and don't support Web Speech Recognition
      unavailableReason =
        "Voice recognition isn't available in this browser on iOS.";
      suggestedAction =
        "Please use Safari on iOS, or try a desktop browser. You can still type your messages.";
    } else {
      // Desktop browser without support (e.g., Firefox)
      unavailableReason =
        "Voice recognition isn't supported in this browser.";
      suggestedAction =
        "Please use Chrome, Edge, or Safari. You can still type your messages.";
    }
  } else if (!hasMicrophoneAPI) {
    unavailableReason = "Microphone access isn't available in this browser.";
    suggestedAction = "Please use a modern browser with microphone support.";
  }

  cachedCapabilities = {
    hasSpeechRecognition,
    hasMicrophoneAPI,
    isIOS,
    isIOSWebKit,
    unavailableReason,
    suggestedAction,
  };

  log("Capabilities detected:", cachedCapabilities);
  log("User-Agent:", userAgent);

  return cachedCapabilities;
}

/**
 * Check if speech recognition is available
 */
export function isSpeechRecognitionAvailable(): boolean {
  return getSpeechCapabilities().hasSpeechRecognition;
}

/**
 * Request microphone permission and check if it's granted.
 */
export async function requestMicrophonePermission(): Promise<MicPermissionResult> {
  if (typeof window === "undefined") {
    return { granted: false, denied: false, error: "Server-side rendering" };
  }

  const caps = getSpeechCapabilities();

  if (!caps.hasMicrophoneAPI) {
    return {
      granted: false,
      denied: false,
      error: "Microphone API not available",
    };
  }

  try {
    // Try to get permission
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Got permission - release the stream immediately
    stream.getTracks().forEach((track) => track.stop());

    log("Microphone permission granted");
    return { granted: true, denied: false, error: null };
  } catch (err: any) {
    log("Microphone permission error:", err.name, err.message);

    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      return {
        granted: false,
        denied: true,
        error: "Microphone permission was denied. Please enable it in your browser settings.",
      };
    }

    if (err.name === "NotFoundError") {
      return {
        granted: false,
        denied: false,
        error: "No microphone found. Please connect a microphone and try again.",
      };
    }

    return {
      granted: false,
      denied: false,
      error: `Microphone error: ${err.message}`,
    };
  }
}

/**
 * Get a user-friendly error message for speech recognition issues.
 */
export function getSpeechErrorMessage(error: any): string {
  if (!error) {
    const caps = getSpeechCapabilities();
    if (caps.unavailableReason) {
      return `${caps.unavailableReason} ${caps.suggestedAction || ""}`.trim();
    }
    return "Voice recognition is unavailable.";
  }

  const errorType = error.error || error.name || error.message || String(error);

  switch (errorType) {
    case "not-allowed":
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Microphone permission was denied. Please enable it in your browser settings and reload the page.";

    case "no-speech":
      return "No speech was detected. Please try again and speak clearly.";

    case "audio-capture":
    case "NotFoundError":
      return "No microphone found. Please connect a microphone and try again.";

    case "network":
      return "Network error during voice recognition. Please check your connection.";

    case "aborted":
      return "Voice recognition was stopped.";

    case "service-not-allowed":
      return "Voice recognition service is not allowed. This may be a browser restriction.";

    default:
      return `Voice recognition error: ${errorType}. Please try typing instead.`;
  }
}

/**
 * Get debug info for voice support (for dev mode display)
 */
export function getVoiceDebugInfo(): string {
  if (typeof window === "undefined") return "SSR";

  const caps = getSpeechCapabilities();
  const ua = navigator.userAgent;

  const lines = [
    `SR: ${caps.hasSpeechRecognition ? "✓" : "✗"}`,
    `Mic: ${caps.hasMicrophoneAPI ? "✓" : "✗"}`,
    `iOS: ${caps.isIOS ? "yes" : "no"}`,
  ];

  if (caps.unavailableReason) {
    lines.push(`⚠ ${caps.unavailableReason}`);
  }

  return lines.join(" | ");
}
