/**
 * Gemini Live API Session Manager
 *
 * Handles WebSocket connection to Gemini Live API for real-time
 * bidirectional audio streaming with function calling support.
 */
import { getBackendWsUrl } from "@/lib/api";

// Types
export interface LiveConfig {
  model?: string;
  systemInstruction?: string;
  tools?: ToolDefinition[];
  voiceName?: string;
  useProxy?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface LiveTranscriptEntry {
  role: "user" | "ai";
  text: string;
  isFinal: boolean;
}

export interface LiveAppEvent {
  type:
  | "REQUIRE_EDIT_CONFIRM"
  | "EDIT_STATUS"
  | "EDIT_COMPLETED"
  | "EDIT_FAILED"
  | "EDIT_CONFIRM_CANCELLED";
  instruction?: string;
  functionCallId?: string;
  functionName?: string;
  status?: string;
  version?: string;
  versionNumber?: number;
  imageBase64?: string;
  mimeType?: string;
  error?: string;
}

export interface LiveSessionCallbacks {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onAudioReceived?: (audioData: ArrayBuffer) => void;
  onInputAudioLevel?: (level: number) => void;
  onTextReceived?: (text: string, isFinal: boolean) => void;
  onUserTranscription?: (text: string, isFinal: boolean) => void;
  onTranscriptEntry?: (entry: LiveTranscriptEntry) => void;
  onAppEvent?: (event: LiveAppEvent) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onError?: (error: string) => void;
  onInterrupted?: () => void;
  onTurnComplete?: () => void;
  onPlaybackComplete?: () => void;
}

type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

const DEBUG = true;
function log(...args: any[]) {
  if (DEBUG) console.log("[LiveSession]", ...args);
}

/**
 * LiveSession - manages a single Gemini Live API WebSocket connection
 */
export class LiveSession {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private state: ConnectionState = "disconnected";
  private callbacks: LiveSessionCallbacks = {};
  private config: LiveConfig;
  private apiKey: string;

  // Audio playback queue
  private audioQueue: ArrayBuffer[] = [];
  private isPlaying = false;
  private scheduledSources: AudioBufferSourceNode[] = [];
  private nextPlayTime = 0;

  // For sending audio
  private mediaStream: MediaStream | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private inputAudioContext: AudioContext | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private ambientNoiseFloorRms = 0.0035;
  private speechGateOpenUntilMs = 0;
  private readonly minSpeechRms = 0.0075;
  private readonly speechThresholdMultiplier = 2.2;
  private readonly gateHoldMs = 360;

  // Connection setup tracking
  private connectResolve: ((connected: boolean) => void) | null = null;
  private setupTimeout: ReturnType<typeof setTimeout> | null = null;
  private setupCompleted = false;
  private intentionalClose = false;

  constructor(apiKey: string, config: LiveConfig = {}) {
    this.apiKey = apiKey;
    this.config = {
      model:
        config.model ||
        process.env.NEXT_PUBLIC_GEMINI_LIVE_MODEL ||
        "gemini-2.5-flash-native-audio-preview-12-2025",  // Works in Node.js, testing browser
      systemInstruction: config.systemInstruction || "",
      tools: config.tools || [],
      voiceName: config.voiceName || "Puck",
      useProxy: config.useProxy ?? true,
    };
    log("LiveSession created. model:", this.config.model);
  }

  /**
   * Connect to Gemini Live API
   */
  async connect(callbacks: LiveSessionCallbacks = {}): Promise<boolean> {
    if (this.state === "connected" || this.state === "connecting") {
      log("Already connected or connecting");
      return false;
    }

    this.callbacks = callbacks;
    this.state = "connecting";
    this.setupCompleted = false;
    this.intentionalClose = false;

    try {
      // Initialize AudioContext
      this.audioContext = new AudioContext({ sampleRate: 24000 });

      // Build WebSocket URL
      const wsUrl = this.buildWebSocketUrl();
      const safeWsUrl = wsUrl.replace(/(key|access_token)=[^&]+/g, "$1=***");
      log("Connecting to:", safeWsUrl);

      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = "arraybuffer";

      return new Promise((resolve) => {
        this.connectResolve = (connected: boolean) => {
          if (this.setupTimeout) {
            clearTimeout(this.setupTimeout);
            this.setupTimeout = null;
          }
          this.connectResolve = null;
          resolve(connected);
        };

        this.setupTimeout = setTimeout(() => {
          if (!this.setupCompleted && this.state === "connecting") {
            this.state = "error";
            this.callbacks.onError?.("Live setup timed out.");
            this.connectResolve?.(false);
            this.disconnect();
          }
        }, 15000);

        if (!this.ws) {
          this.connectResolve?.(false);
          return;
        }

        this.ws.onopen = () => {
          log("WebSocket connected");
          this.sendSetupMessage();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          log("WebSocket error:", error);
          this.state = "error";
          let hint = "";
          try {
            if (wsUrl.startsWith("ws://") || wsUrl.startsWith("wss://")) {
              const parsed = new URL(wsUrl);
              hint = ` Check proxy reachability at ${parsed.protocol === "wss:" ? "https" : "http"}://${parsed.host}/health.`;
            }
          } catch { }
          this.callbacks.onError?.(`WebSocket connection error (${safeWsUrl}).${hint}`);
          this.connectResolve?.(false);
        };

        this.ws.onclose = (event) => {
          const wasSetupCompleted = this.setupCompleted;
          const wasIntentionalClose = this.intentionalClose;
          this.intentionalClose = false;
          log("WebSocket closed:", event.code, event.reason || "(no reason)");
          this.state = "disconnected";
          this.cleanup();

          if (!wasIntentionalClose && !wasSetupCompleted) {
            const reason = event.reason?.trim();
            const baseError = reason
              ? `Live connection closed before setup completed (code ${event.code}: ${reason}).`
              : `Live connection closed before setup completed (code ${event.code}).`;
            const policyHint =
              event.code === 1008
                ? " Policy violation: check API key restrictions/leak status and Live model availability."
                : "";
            const netHint =
              event.code === 1006
                ? " Network disconnect: verify phone and server are on same LAN, and proxy URL/protocol are correct."
                : "";
            this.callbacks.onError?.(`${baseError}${policyHint}${netHint}`);
          }

          this.callbacks.onDisconnected?.();
          this.connectResolve?.(false);
        };
      });
    } catch (error: any) {
      log("Connection error:", error);
      this.state = "error";
      this.callbacks.onError?.(error.message);
      return false;
    }
  }

  /**
   * Build the WebSocket URL for Gemini Live API
   * Uses backend proxy when NEXT_PUBLIC_WS_URL is configured
   */
  private buildWebSocketUrl(): string {
    // Check for proxy URL (recommended for browser clients)
    if (this.config.useProxy !== false) {
      const proxyUrl = getBackendWsUrl();
      if (proxyUrl) {
        if (
          typeof window !== "undefined" &&
          window.location.protocol === "https:" &&
          proxyUrl.startsWith("ws://")
        ) {
          throw new Error(
            "NEXT_PUBLIC_WS_URL must use wss:// when the app is served over https://"
          );
        }
        log("Using WebSocket proxy:", proxyUrl);
        return proxyUrl;
      }
    }

    const credential = this.apiKey?.trim();
    if (!credential) {
      throw new Error("Missing Gemini Live credential.");
    }

    // Direct connection fallback.
    // NOTE: Ephemeral auth tokens must use v1alpha constrained endpoint + access_token.
    if (credential.startsWith("auth_tokens/")) {
      log("Using direct Gemini connection with ephemeral auth token");
      const constrainedUrl =
        "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";
      return `${constrainedUrl}?access_token=${encodeURIComponent(credential)}`;
    }

    log("Using direct Gemini connection with API key");
    const baseUrl =
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
    return `${baseUrl}?key=${encodeURIComponent(credential)}`;
  }

  /**
   * Send initial setup message
   */
  private sendSetupMessage(): void {
    const setup = {
      setup: {
        model: `models/${this.config.model}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.config.voiceName,
              },
            },
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction: this.config.systemInstruction
          ? { parts: [{ text: this.config.systemInstruction }] }
          : undefined,
        tools: this.config.tools?.length
          ? [{ functionDeclarations: this.config.tools }]
          : undefined,
      },
    };

    log("Setup message:", JSON.stringify(setup, null, 2).substring(0, 500));
    this.send(setup, true);  // Force send during connecting state
    log("Setup message sent");
  }

  /**
   * Send a message to the WebSocket
   * Note: During setup phase, we need to send even when state is "connecting"
   */
  private send(data: any, force: boolean = false): void {
    if (this.ws && (this.state === "connected" || force)) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: ArrayBuffer | string): void {
    try {
      const message = typeof data === "string" ? JSON.parse(data) : JSON.parse(new TextDecoder().decode(data));

      // Handle setup complete
      if (message.setupComplete) {
        log("Setup complete");
        this.setupCompleted = true;
        this.state = "connected";
        this.callbacks.onConnected?.();
        this.connectResolve?.(true);
        return;
      }

      if (typeof message.type === "string" && message.type.startsWith("EDIT")) {
        this.callbacks.onAppEvent?.(message as LiveAppEvent);
        return;
      }

      if (message.type === "REQUIRE_EDIT_CONFIRM") {
        this.callbacks.onAppEvent?.(message as LiveAppEvent);
        return;
      }

      if (message.error) {
        const details =
          message.error.message ||
          message.error.details ||
          message.error.status ||
          JSON.stringify(message.error);
        this.callbacks.onError?.(`Live API error: ${details}`);
        return;
      }

      if (message.transcript) {
        const rawRole = message.transcript.role;
        const role: "user" | "ai" | null =
          rawRole === "user" ? "user" : rawRole === "ai" ? "ai" : null;
        const rawText =
          typeof message.transcript.text === "string" ? message.transcript.text : "";
        const cleanedText =
          role === "ai"
            ? rawText.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/\[\s*thinking[^\]]*]/gi, "").trim()
            : rawText;
        if (role && cleanedText) {
          const isFinal = message.transcript.isFinal === true;
          this.callbacks.onTranscriptEntry?.({ role, text: cleanedText, isFinal });
          if (role === "user") {
            this.callbacks.onUserTranscription?.(cleanedText, isFinal);
          } else {
            this.callbacks.onTextReceived?.(cleanedText, isFinal);
          }
        }
        return;
      }

      // Handle server content (audio + speech transcription)
      const content = message.serverContent || message.server_content;
      if (content) {
        const modelTurn = content.modelTurn || content.model_turn;
        const turnComplete = Boolean(content.turnComplete ?? content.turn_complete);

        // Model turn with parts
        if (modelTurn?.parts) {
          for (const part of modelTurn.parts) {
            if (
              typeof part.text === "string" &&
              part.text.trim() &&
              !part.thought &&
              !part.thoughtSignature &&
              !part.thought_signature
            ) {
              const cleanedText = part.text
                .replace(/<think>[\s\S]*?<\/think>/gi, "")
                .replace(/\[\s*thinking[^\]]*]/gi, "")
                .trim();
              if (cleanedText) {
                this.callbacks.onTextReceived?.(cleanedText, turnComplete);
              }
            }

            // Audio response (inline data)
            if (part.inlineData?.data) {
              const audioBytes = this.base64ToArrayBuffer(part.inlineData.data);
              this.callbacks.onAudioReceived?.(audioBytes);
              this.queueAudio(audioBytes);
            }
          }
        }

        // Direct audio content
        if (content.audioContent) {
          const audioBytes = this.base64ToArrayBuffer(content.audioContent);
          this.callbacks.onAudioReceived?.(audioBytes);
          this.queueAudio(audioBytes);
        }

        const outputTranscriptionText =
          content.outputTranscription?.text ||
          content.outputTranscription?.transcript ||
          content.outputTranscription?.partialText ||
          content.outputTranscription?.partial_text ||
          content.output_transcription?.text ||
          content.output_transcription?.transcript ||
          content.output_transcription?.partialText ||
          content.output_transcription?.partial_text ||
          content.outputAudioTranscription?.text ||
          content.outputAudioTranscription?.transcript ||
          content.outputAudioTranscription?.partialText ||
          content.outputAudioTranscription?.partial_text ||
          content.output_audio_transcription?.text ||
          content.output_audio_transcription?.transcript ||
          content.output_audio_transcription?.partialText ||
          content.output_audio_transcription?.partial_text;
        if (typeof outputTranscriptionText === "string" && outputTranscriptionText.trim()) {
          const isOutputFinal =
            Boolean(content.outputTranscription?.finished) ||
            Boolean(content.outputTranscription?.isFinal) ||
            Boolean(content.outputTranscription?.is_final) ||
            Boolean(content.output_transcription?.finished) ||
            Boolean(content.output_transcription?.isFinal) ||
            Boolean(content.output_transcription?.is_final) ||
            Boolean(content.outputAudioTranscription?.finished) ||
            Boolean(content.outputAudioTranscription?.isFinal) ||
            Boolean(content.outputAudioTranscription?.is_final) ||
            Boolean(content.output_audio_transcription?.finished) ||
            Boolean(content.output_audio_transcription?.isFinal) ||
            Boolean(content.output_audio_transcription?.is_final) ||
            turnComplete;
          this.callbacks.onTextReceived?.(outputTranscriptionText, isOutputFinal);
        }

        const inputTranscriptionText =
          content.inputTranscription?.text ||
          content.inputTranscription?.transcript ||
          content.inputTranscription?.partialText ||
          content.inputTranscription?.partial_text ||
          content.input_transcription?.text ||
          content.input_transcription?.transcript ||
          content.input_transcription?.partialText ||
          content.input_transcription?.partial_text ||
          content.inputAudioTranscription?.text ||
          content.inputAudioTranscription?.transcript ||
          content.inputAudioTranscription?.partialText ||
          content.inputAudioTranscription?.partial_text ||
          content.input_audio_transcription?.text ||
          content.input_audio_transcription?.transcript ||
          content.input_audio_transcription?.partialText ||
          content.input_audio_transcription?.partial_text;
        if (typeof inputTranscriptionText === "string" && inputTranscriptionText.trim()) {
          const isInputFinal =
            Boolean(content.inputTranscription?.finished) ||
            Boolean(content.inputTranscription?.isFinal) ||
            Boolean(content.inputTranscription?.is_final) ||
            Boolean(content.input_transcription?.finished) ||
            Boolean(content.input_transcription?.isFinal) ||
            Boolean(content.input_transcription?.is_final) ||
            Boolean(content.inputAudioTranscription?.finished) ||
            Boolean(content.inputAudioTranscription?.isFinal) ||
            Boolean(content.inputAudioTranscription?.is_final) ||
            Boolean(content.input_audio_transcription?.finished) ||
            Boolean(content.input_audio_transcription?.isFinal) ||
            Boolean(content.input_audio_transcription?.is_final);
          this.callbacks.onUserTranscription?.(inputTranscriptionText, isInputFinal);
        }

        // Interrupted
        if (content.interrupted) {
          log("Response interrupted");
          this.stopPlayback();
          this.callbacks.onInterrupted?.();
        }

        // Turn complete
        if (turnComplete) {
          log("Turn complete");
          this.callbacks.onTurnComplete?.();
        }
      }

      // Handle tool call
      if (message.toolCall) {
        const functionCall = message.toolCall.functionCalls?.[0];
        const rawArgs = functionCall?.args || {};
        let parsedArgs: Record<string, any> = {};

        if (typeof rawArgs === "string") {
          try {
            parsedArgs = JSON.parse(rawArgs);
          } catch {
            parsedArgs = { raw: rawArgs };
          }
        } else {
          parsedArgs = rawArgs;
        }

        const toolCall: ToolCall = {
          id: functionCall?.id || message.toolCall.id || crypto.randomUUID(),
          name: functionCall?.name || "",
          args: parsedArgs,
        };
        log("Tool call received:", toolCall);
        this.callbacks.onToolCall?.(toolCall);
      }
    } catch (error) {
      log("Error parsing message:", error);
    }
  }

  /**
   * Convert base64 to ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Queue audio for playback
   */
  private queueAudio(audioData: ArrayBuffer): void {
    this.audioQueue.push(audioData);
    if (!this.isPlaying) {
      this.isPlaying = true;
      this.processAudioQueue();
    } else {
      this.processAudioQueue();
    }
  }

  /**
   * Process all queued audio buffers and schedule them gaplessly
   */
  private async processAudioQueue(): Promise<void> {
    if (!this.audioContext || this.audioQueue.length === 0) return;

    try {
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      while (this.audioQueue.length > 0) {
        const audioData = this.audioQueue.shift()!;

        // Convert PCM16 to Float32
        const int16Array = new Int16Array(audioData);
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
          float32Array[i] = int16Array[i] / 32768;
        }

        // Create AudioBuffer
        const audioBuffer = this.audioContext.createBuffer(
          1,
          float32Array.length,
          24000
        );
        audioBuffer.copyToChannel(float32Array, 0);

        // Play
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);

        // Schedule gapless
        const currentTime = this.audioContext.currentTime;
        if (this.nextPlayTime < currentTime) {
          this.nextPlayTime = currentTime;
        }

        source.start(this.nextPlayTime);
        this.nextPlayTime += audioBuffer.duration;
        this.scheduledSources.push(source);

        source.onended = () => {
          const idx = this.scheduledSources.indexOf(source);
          if (idx !== -1) {
            this.scheduledSources.splice(idx, 1);
          }
          if (this.scheduledSources.length === 0 && this.audioQueue.length === 0) {
            this.isPlaying = false;
            this.callbacks.onPlaybackComplete?.();
          }
        };
      }
    } catch (error) {
      log("Error playing audio:", error);
      this.isPlaying = false;
    }
  }

  /**
   * Stop current playback
   */
  private stopPlayback(): void {
    this.audioQueue = [];
    this.scheduledSources.forEach((source) => {
      try {
        source.stop();
      } catch { }
    });
    this.scheduledSources = [];
    this.nextPlayTime = 0;
    this.isPlaying = false;
  }

  private resetInputNoiseGate(): void {
    this.ambientNoiseFloorRms = 0.0035;
    this.speechGateOpenUntilMs = 0;
  }

  /**
   * Start sending audio from microphone
   */
  async startAudioInput(): Promise<boolean> {
    if (!this.audioContext || this.state !== "connected") {
      return false;
    }

    if (this.mediaStream && this.processorNode && this.inputAudioContext) {
      return true;
    }

    try {
      this.stopAudioInput();
      this.resetInputNoiseGate();

      // Get microphone access without strict hardware sampleRate constraints 
      // (forcing 16000Hz causes Apple devices to drop AirPods and fallback to Continuity iPhone mics)
      let stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');

        let preferredDevice = audioInputs.find(d =>
          d.label.toLowerCase().includes('airpods') ||
          d.label.toLowerCase().includes('headset') ||
          d.label.toLowerCase().includes('headphones') ||
          d.label.toLowerCase().includes('earpods')
        );

        // If on Mac and it grabbed the Continuity Camera iPhone mic by default, 
        // try to force it back to Mac built-in if no headset is found.
        if (!preferredDevice) {
          const hasIphone = audioInputs.some(d => d.label.toLowerCase().includes('iphone'));
          const builtIn = audioInputs.find(d => d.label.toLowerCase().includes('macbook') || d.label.toLowerCase().includes('built-in'));
          if (hasIphone && builtIn) {
            preferredDevice = builtIn;
          }
        }

        if (preferredDevice) {
          const currentTrack = stream.getAudioTracks()[0];
          if (currentTrack && currentTrack.label !== preferredDevice.label) {
            log("Switching audio input from", currentTrack.label, "to preferred device:", preferredDevice.label);
            stream.getTracks().forEach(t => t.stop());
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                deviceId: { exact: preferredDevice.deviceId },
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              }
            });
          }
        }
      } catch (e) {
        log("Device enumeration failed, using default stream:", e);
      }

      this.mediaStream = stream;

      // Create audio processing pipeline
      this.inputAudioContext = new AudioContext({ sampleRate: 16000 });
      if (this.inputAudioContext.state === "suspended") {
        await this.inputAudioContext.resume();
      }
      this.mediaStreamSource = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream
      );

      // Use ScriptProcessor for audio data (simpler than AudioWorklet)
      this.processorNode = this.inputAudioContext.createScriptProcessor(4096, 1, 1);
      this.processorNode.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        this.sendAudioChunk(inputData);

        // ALWAYS zero out the output buffer to prevent microphone input from looping back to headphones
        const outputData = e.outputBuffer.getChannelData(0);
        for (let i = 0; i < outputData.length; i++) {
          outputData[i] = 0;
        }
      };

      this.mediaStreamSource.connect(this.processorNode);
      this.processorNode.connect(this.inputAudioContext.destination);

      log("Audio input started");
      return true;
    } catch (error: any) {
      log("Error starting audio input:", error);
      this.callbacks.onError?.(error.message);
      return false;
    }
  }

  /**
   * Send audio chunk to Gemini
   */
  private sendAudioChunk(float32Data: Float32Array): void {
    if (this.state !== "connected") return;

    let powerSum = 0;
    for (let i = 0; i < float32Data.length; i++) {
      powerSum += float32Data[i] * float32Data[i];
    }
    const rms = Math.sqrt(powerSum / Math.max(float32Data.length, 1));
    if (!Number.isFinite(rms)) {
      return;
    }

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const dynamicThreshold = Math.max(
      this.minSpeechRms,
      this.ambientNoiseFloorRms * this.speechThresholdMultiplier
    );
    // When AI is playing audio, require much louder speech to prevent echo
    // 3.0x threshold should suppress most echo while still allowing barge-in
    const effectiveThreshold = this.isPlaying ? dynamicThreshold * 3.0 : dynamicThreshold;
    const isSpeech = rms >= effectiveThreshold;

    if (isSpeech) {
      this.speechGateOpenUntilMs = now + this.gateHoldMs;
    } else {
      const adaptRate = rms > this.ambientNoiseFloorRms ? 0.12 : 0.03;
      this.ambientNoiseFloorRms += (rms - this.ambientNoiseFloorRms) * adaptRate;
      this.ambientNoiseFloorRms = Math.min(Math.max(this.ambientNoiseFloorRms, 0.0025), 0.03);
    }

    const gateOpen = isSpeech || now < this.speechGateOpenUntilMs;
    const normalizedLevel = gateOpen
      ? Math.min(1, Math.max(0, (rms - effectiveThreshold * 0.45) * 16))
      : 0;
    this.callbacks.onInputAudioLevel?.(normalizedLevel);

    // Convert Float32 to Int16 (PCM16)
    const int16Data = new Int16Array(float32Data.length);
    if (gateOpen) {
      for (let i = 0; i < float32Data.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Data[i]));
        int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
    }

    // Convert to base64
    const bytes = new Uint8Array(int16Data.buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    // Send to Gemini
    this.send({
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: "audio/pcm;rate=16000",
            data: base64,
          },
        ],
      },
    });
  }

  /**
   * Stop audio input
   */
  stopAudioInput(): void {
    if (this.processorNode) {
      this.processorNode.onaudioprocess = null;
      this.processorNode.disconnect();
      this.processorNode = null;
    }

    if (this.mediaStreamSource) {
      this.mediaStreamSource.disconnect();
      this.mediaStreamSource = null;
    }

    if (this.inputAudioContext) {
      void this.inputAudioContext.close();
      this.inputAudioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.resetInputNoiseGate();
    this.callbacks.onInputAudioLevel?.(0);

    log("Audio input stopped");
  }

  /**
   * Send text message
   */
  sendText(text: string): void {
    if (this.state !== "connected") return;

    this.send({
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [{ text }],
          },
        ],
        turnComplete: true,
      },
    });
  }

  /**
   * Send image for context
   */
  sendImage(base64Data: string, mimeType: string, promptText: string = "I just uploaded this photo. What do you see?"): void {
    if (this.state !== "connected") return;

    this.send({
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
              {
                text: promptText,
              },
            ],
          },
        ],
        turnComplete: true,
      },
    });
  }

  /**
   * Send tool result back to Gemini
   */
  sendToolResult(toolCallId: string, result: any): void {
    if (this.state !== "connected") return;

    this.send({
      toolResponse: {
        functionResponses: [
          {
            id: toolCallId,
            response: result,
          },
        ],
      },
    });
  }

  confirmEdit(instruction: string, imageBase64: string, mimeType: string): void {
    if (this.state !== "connected") return;

    this.send({
      type: "CONFIRM_EDIT",
      instruction,
      imageBase64,
      mimeType,
    });
  }

  cancelEditConfirm(): void {
    if (this.state !== "connected") return;
    this.send({
      type: "CANCEL_EDIT_CONFIRM",
    });
  }

  /**
   * Interrupt current response (barge-in)
   */
  interrupt(): void {
    this.stopPlayback();
    // The server will automatically handle the interruption
    // when we start sending new audio
  }

  /**
   * Disconnect from the API
   */
  disconnect(): void {
    this.intentionalClose = true;
    if (this.setupTimeout) {
      clearTimeout(this.setupTimeout);
      this.setupTimeout = null;
    }
    this.connectResolve = null;
    this.setupCompleted = false;

    this.stopAudioInput();
    this.stopPlayback();
    if (this.ws) {
      this.ws.close(1000, "Client closing session");
      this.ws = null;
    }
    this.state = "disconnected";
    log("Disconnected");
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    if (this.setupTimeout) {
      clearTimeout(this.setupTimeout);
      this.setupTimeout = null;
    }
    this.connectResolve = null;
    this.setupCompleted = false;

    this.stopAudioInput();
    this.stopPlayback();
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === "connected";
  }
}

/**
 * Default system instruction for photo recall
 */
export const DEFAULT_SYSTEM_INSTRUCTION = `You are a warm, empathetic companion helping users recall and reflect on their photo memories.

Your role:
1. When shown a photo, describe what you see with curiosity and warmth
2. Ask gentle questions about the moment, emotions, and memories it evokes
3. Listen actively and respond thoughtfully to what the user shares
4. If the user asks to edit the photo, warmly agree to help. Another system processes the edit, so you do not need to use any tools yourself.
5. Keep responses conversational and natural - you're having a flowing dialogue

Guidelines:
- Be warm but not overly enthusiastic
- Ask one question at a time
- Acknowledge emotions the user expresses
- Keep your responses concise for natural conversation flow

Remember: This is an audio conversation. Keep responses natural and conversational.`;
