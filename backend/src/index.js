import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { WebSocket, WebSocketServer } from "ws";

dotenv.config();

const PORT = Number(process.env.PORT || 8080);
const LIVE_PROXY_PATH = process.env.LIVE_PROXY_PATH || "/ws/live";
const GEMINI_WS_URL =
  process.env.GEMINI_WS_URL ||
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 25000);
const MAX_QUEUE_MESSAGES = Number(process.env.MAX_QUEUE_MESSAGES || 120);

const IMAGE_MODEL = "gemini-2.0-flash-exp-image-generation";
const CHAT_MODEL = "gemini-2.5-pro";
const TRANSCRIBE_MODEL = "gemini-2.0-flash";
const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const CHAT_TIMEOUT_MS = 60000;
const TRANSCRIBE_TIMEOUT_MS = 30000;
const TTS_TIMEOUT_MS = 30000;


const DIRECTOR_NOTE = `Speak in a warm, soft, natural conversational tone.
Moderate pace, gentle intonation, light pauses, like a friendly chat, not like reading an announcement.
Text: `;

const corsOriginsRaw = (process.env.CORS_ORIGINS || "*").trim();
const allowAllOrigins = corsOriginsRaw === "*" || corsOriginsRaw === "";
const allowedOrigins = new Set(
  corsOriginsRaw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

function createSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend environment."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

const supabase = createSupabaseAdminClient();

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowAllOrigins || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} is not allowed by CORS_ORIGINS`));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));

function getGeminiApiKey() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error("Server missing GEMINI_API_KEY (or GOOGLE_API_KEY).");
  }
  return key;
}

function createGeminiClient(options = {}) {
  return new GoogleGenAI({
    apiKey: getGeminiApiKey(),
    ...options,
  });
}

function hashPassword(password) {
  return createHash("sha256").update(password).digest("hex");
}

function createToken(userId) {
  return Buffer.from(`${userId}:${Date.now()}`, "utf-8").toString("base64");
}

function getUserIdFromAuthHeader(authorization) {
  if (!authorization) return null;
  try {
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    return decoded.split(":")[0] || null;
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const userId = getUserIdFromAuthHeader(req.headers.authorization);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  next();
}

function withTimeout(promise, ms, errorMsg) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(errorMsg)), ms);
    }),
  ]);
}

function isNoRowsError(error) {
  return error?.code === "PGRST116";
}

function toSafeString(value, fallback = "") {
  if (typeof value === "string") return value;
  return fallback;
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry));
}

function mapProfileRow(row) {
  return {
    userId: row.user_id,
    name: row.name || "",
    hobbies: Array.isArray(row.hobbies) ? row.hobbies : [],
    selfIntro: row.self_intro || "",
    preferences: row.preferences && typeof row.preferences === "object" ? row.preferences : {},
    conversationSummaries: Array.isArray(row.conversation_summaries)
      ? row.conversation_summaries
      : [],
    onboardingComplete: Boolean(row.onboarding_complete),
  };
}

function mapConversationRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    imageDataUrl: row.image_data_url || "",
    imageMimeType: row.image_mime_type || "image/jpeg",
    imageVersions: Array.isArray(row.image_versions) ? row.image_versions : [],
    messages: Array.isArray(row.messages) ? row.messages : [],
    name: row.name ?? null,
  };
}

function buildSystemInstruction(profileContext) {
  const profileInfo = profileContext
    ? `\n\nYou know this about the user: ${profileContext}. Use this to personalize the conversation and make them feel understood.`
    : "";

  return `You are a warm, empathetic recall companion. The user is reviewing their photos from today and recalling their day.${profileInfo}

Your conversation flow:
1. When the user uploads a photo, describe what you see in it
2. Ask gentle, open-ended questions about the context, emotions, and story behind the photo
3. After a few exchanges, naturally suggest editing the photo to enhance the memory (e.g., "Would you like to add a warm filter to capture how cozy this moment felt?")
4. When the user agrees to or requests an edit, include [EDIT_SUGGESTION: exact edit description] at the end of your response
5. After an edit is applied, comment on the result and continue the conversation
6. The session is about 5 minutes — keep things flowing naturally

Rules:
- Keep responses concise (2-3 sentences)
- Support both English and Chinese — respond in whatever language the user speaks
- Be conversational and supportive, like a caring friend
- Only include [EDIT_SUGGESTION: ...] when the user clearly wants an edit
- Reference what you know about the user to make them feel understood`;
}

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    storage: "supabase",
    corsOrigins: allowAllOrigins ? "*" : Array.from(allowedOrigins),
    wsPath: LIVE_PROXY_PATH,
    timestamp: new Date().toISOString(),
  });
});

app.post("/api/auth", async (req, res) => {
  const { action, username, password } = req.body || {};
  const normalizedUsername = toSafeString(username).trim();
  const passwordText = toSafeString(password);

  if (!normalizedUsername || !passwordText) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }

  try {
    if (action === "register") {
      const { data: existingUser, error: existingUserError } = await supabase
        .from("users")
        .select("id")
        .eq("username", normalizedUsername)
        .maybeSingle();

      if (existingUserError && !isNoRowsError(existingUserError)) {
        throw existingUserError;
      }

      if (existingUser) {
        res.status(400).json({ error: "Username already exists" });
        return;
      }

      const { data: newUser, error: insertUserError } = await supabase
        .from("users")
        .insert([
          {
            username: normalizedUsername,
            password_hash: hashPassword(passwordText),
          },
        ])
        .select("id")
        .single();

      if (insertUserError) {
        if (insertUserError.code === "23505") {
          res.status(400).json({ error: "Username already exists" });
          return;
        }
        throw insertUserError;
      }

      const { error: insertProfileError } = await supabase.from("profiles").insert([
        {
          user_id: newUser.id,
        },
      ]);

      if (insertProfileError) {
        throw insertProfileError;
      }

      res.json({ token: createToken(newUser.id), userId: newUser.id });
      return;
    }

    if (action === "login") {
      const { data: user, error: userError } = await supabase
        .from("users")
        .select("id, password_hash")
        .eq("username", normalizedUsername)
        .maybeSingle();

      if (userError && !isNoRowsError(userError)) {
        throw userError;
      }

      if (!user || user.password_hash !== hashPassword(passwordText)) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      res.json({ token: createToken(user.id), userId: user.id });
      return;
    }

    res.status(400).json({ error: "Invalid action" });
  } catch (error) {
    console.error("Auth error:", error);
    res.status(500).json({ error: "Auth request failed" });
  }
});

app.get("/api/profile", requireAuth, async (req, res) => {
  try {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", req.userId)
      .maybeSingle();

    if (error && !isNoRowsError(error)) {
      throw error;
    }

    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    res.json(mapProfileRow(profile));
  } catch (error) {
    console.error("Profile GET error:", error);
    res.status(500).json({ error: "Failed to load profile" });
  }
});

app.put("/api/profile", requireAuth, async (req, res) => {
  const updates = req.body || {};
  const payload = {
    updated_at: new Date().toISOString(),
  };

  if ("name" in updates) payload.name = toSafeString(updates.name);
  if ("hobbies" in updates) payload.hobbies = toStringArray(updates.hobbies);
  if ("selfIntro" in updates) payload.self_intro = toSafeString(updates.selfIntro);
  if ("preferences" in updates) {
    payload.preferences =
      updates.preferences && typeof updates.preferences === "object"
        ? updates.preferences
        : {};
  }
  if ("conversationSummaries" in updates) {
    payload.conversation_summaries = toStringArray(updates.conversationSummaries);
  }
  if ("onboardingComplete" in updates) {
    payload.onboarding_complete = Boolean(updates.onboardingComplete);
  }

  try {
    const { data: profile, error } = await supabase
      .from("profiles")
      .update(payload)
      .eq("user_id", req.userId)
      .select("*")
      .maybeSingle();

    if (error && !isNoRowsError(error)) {
      throw error;
    }

    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    res.json(mapProfileRow(profile));
  } catch (error) {
    console.error("Profile PUT error:", error);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

app.get("/api/conversations", requireAuth, async (req, res) => {
  try {
    const { data: rows, error } = await supabase
      .from("conversations")
      .select("*")
      .eq("user_id", req.userId)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    const userConversations = (rows || []).map((row) => {
      const conversation = mapConversationRow(row);
      const thumbnailDataUrl =
        conversation.imageVersions.find((version) => typeof version?.dataUrl === "string" && version.dataUrl)?.dataUrl ||
        conversation.imageDataUrl ||
        null;
      return {
        id: conversation.id,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: conversation.messages.length,
        versionCount: conversation.imageVersions.length,
        preview:
          conversation.messages.find((message) => message.role === "model")?.text.slice(0, 100) ||
          "",
        hasImage: Boolean(thumbnailDataUrl),
        thumbnailDataUrl,
        name: conversation.name,
      };
    });

    res.json(userConversations);
  } catch (error) {
    console.error("Conversations GET error:", error);
    res.status(500).json({ error: "Failed to load conversations" });
  }
});

app.post("/api/conversations", requireAuth, async (req, res) => {
  const { imageDataUrl, imageMimeType } = req.body || {};
  const safeImageDataUrl = toSafeString(imageDataUrl);
  const safeImageMimeType = toSafeString(imageMimeType, "image/jpeg") || "image/jpeg";
  const nowIso = new Date().toISOString();
  const initialVersions = safeImageDataUrl
    ? [{ dataUrl: safeImageDataUrl, editPrompt: "", timestamp: Date.now() }]
    : [];

  try {
    const { data: created, error } = await supabase
      .from("conversations")
      .insert([
        {
          user_id: req.userId,
          created_at: nowIso,
          updated_at: nowIso,
          image_data_url: safeImageDataUrl,
          image_mime_type: safeImageMimeType,
          image_versions: initialVersions,
          messages: [],
          name: null,
        },
      ])
      .select("id")
      .single();

    if (error) throw error;

    res.json({ id: created.id });
  } catch (error) {
    console.error("Conversations POST error:", error);
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

app.get("/api/conversations/:id", requireAuth, async (req, res) => {
  try {
    const { data: row, error } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", req.params.id)
      .eq("user_id", req.userId)
      .maybeSingle();

    if (error && !isNoRowsError(error)) {
      throw error;
    }

    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json(mapConversationRow(row));
  } catch (error) {
    console.error("Conversation GET by id error:", error);
    res.status(500).json({ error: "Failed to load conversation" });
  }
});

app.put("/api/conversations/:id", requireAuth, async (req, res) => {
  const updates = req.body || {};
  const payload = {
    updated_at: new Date().toISOString(),
  };

  if ("messages" in updates) {
    payload.messages = Array.isArray(updates.messages) ? updates.messages : [];
  }
  if ("imageVersions" in updates) {
    payload.image_versions = Array.isArray(updates.imageVersions)
      ? updates.imageVersions
      : [];
  }
  if ("imageDataUrl" in updates) {
    payload.image_data_url = toSafeString(updates.imageDataUrl);
  }
  if ("imageMimeType" in updates) {
    payload.image_mime_type = toSafeString(updates.imageMimeType, "image/jpeg") || "image/jpeg";
  }
  if ("name" in updates) {
    payload.name = updates.name === null ? null : toSafeString(updates.name);
  }

  try {
    const { data: row, error } = await supabase
      .from("conversations")
      .update(payload)
      .eq("id", req.params.id)
      .eq("user_id", req.userId)
      .select("id")
      .maybeSingle();

    if (error && !isNoRowsError(error)) {
      throw error;
    }

    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("Conversation PUT error:", error);
    res.status(500).json({ error: "Failed to update conversation" });
  }
});

app.delete("/api/conversations/:id", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("conversations")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", req.userId)
      .select("id");

    if (error) throw error;

    if (!data || data.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("Conversation DELETE error:", error);
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

app.post("/api/live-token", requireAuth, async (_req, res) => {
  try {
    const now = Date.now();
    const ai = createGeminiClient({
      httpOptions: { apiVersion: "v1alpha" },
    });

    const token = await ai.authTokens.create({
      config: {
        uses: 3,
        newSessionExpireTime: new Date(now + 5 * 60 * 1000).toISOString(),
        expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
      },
    });

    if (!token?.name) {
      throw new Error("No live token returned");
    }

    res.json({ token: token.name });
  } catch (error) {
    res.status(500).json({
      error: error?.message || "Failed to create live token",
    });
  }
});

app.post("/api/chat", async (req, res) => {
  const {
    messages,
    imageBase64,
    imageMimeType,
    profileContext,
    stream: useStream,
  } = req.body || {};

  if (!Array.isArray(messages)) {
    res.status(400).json({ error: "messages must be an array" });
    return;
  }

  const contents = messages.map((message) => {
    const parts = [{ text: message.text || "" }];
    if (message.imageBase64) {
      parts.unshift({
        inlineData: {
          data: message.imageBase64,
          mimeType: message.imageMimeType || "image/jpeg",
        },
      });
    }
    return {
      role: message.role === "user" ? "user" : "model",
      parts,
    };
  });

  if (imageBase64 && contents.length > 0) {
    const last = contents[contents.length - 1];
    if (last.role === "user") {
      last.parts.unshift({
        inlineData: {
          data: imageBase64,
          mimeType: imageMimeType || "image/jpeg",
        },
      });
    }
  }

  const systemInstruction = buildSystemInstruction(profileContext);

  try {
    const ai = createGeminiClient();

    if (useStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const response = await ai.models.generateContentStream({
        model: CHAT_MODEL,
        contents,
        config: { systemInstruction },
      });

      for await (const chunk of response) {
        const text = chunk.text || "";
        if (text) {
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    const response = await Promise.race([
      ai.models.generateContent({
        model: CHAT_MODEL,
        contents,
        config: { systemInstruction },
      }),
      new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("Chat request timed out")),
          CHAT_TIMEOUT_MS
        );
      }),
    ]);

    res.json({ text: response.text || "" });
  } catch (error) {
    const status = error?.message?.includes("timed out") ? 504 : 500;
    res.status(status).json({ error: error?.message || "Chat request failed" });
  }
});

async function runImageEdit({ imageBase64, mimeType, editPrompt }) {
  if (!imageBase64 || !editPrompt) {
    throw new Error("imageBase64 and editPrompt are required");
  }

  const ai = createGeminiClient();
  const response = await ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              data: imageBase64,
              mimeType: mimeType || "image/jpeg",
            },
          },
          { text: `Edit this image: ${editPrompt}` },
        ],
      },
    ],
    config: {
      responseModalities: ["image", "text"],
    },
  });

  const parts = response.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      return {
        imageBase64: part.inlineData.data,
        mimeType: part.inlineData.mimeType || "image/jpeg",
      };
    }
  }

  const fallbackMessage =
    parts.find((part) => part.text)?.text || "No image returned from model";
  throw new Error(fallbackMessage);
}

app.post("/api/edit-image", async (req, res) => {
  const { imageBase64, mimeType, editPrompt } = req.body || {};

  if (!imageBase64 || !editPrompt) {
    res.status(400).json({ error: "imageBase64 and editPrompt are required" });
    return;
  }

  try {
    const result = await runImageEdit({ imageBase64, mimeType, editPrompt });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error?.message || "Image edit failed" });
  }
});

app.post("/api/extract-edit-intent", async (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Missing text payload" });
    return;
  }

  try {
    const ai = createGeminiClient();
    const systemInstruction = `You extract image editing intents from user transcripts.
The user is speaking to a voice assistant about a photo they are looking at.
Determine if the user's latest message contains a request to edit, modify, filter, or alter the photo.
If YES, set isEditRequest to true, and extract their core instruction into editPrompt.
If NO, set isEditRequest to false, and leave editPrompt empty.
Output ONLY strict JSON matching this schema: {"isEditRequest": boolean, "editPrompt": string}`;

    const response = await ai.models.generateContent({
      model: CHAT_MODEL,
      contents: [{ role: "user", parts: [{ text }] }],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
      },
    });

    const outputText = response.text || "{}";
    const result = JSON.parse(outputText);
    res.json({
      isEditRequest: Boolean(result.isEditRequest),
      editPrompt: result.editPrompt || "",
    });
  } catch (error) {
    console.error("Intent extraction error:", error);
    res.status(500).json({ error: "Failed to extract intent" });
  }
});

app.post("/api/tts", async (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Missing text" });
    return;
  }

  try {
    const ai = createGeminiClient();
    const response = await withTimeout(
      ai.models.generateContent({
        model: TTS_MODEL,
        contents: [{ role: "user", parts: [{ text: DIRECTOR_NOTE + text }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Despina" },
            },
          },
        },
      }),
      TTS_TIMEOUT_MS,
      "TTS request timed out"
    );

    const parts = response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        res.json({
          audioBase64: part.inlineData.data,
          mimeType: part.inlineData.mimeType || "audio/L16;rate=24000",
        });
        return;
      }
    }

    res.status(500).json({ error: "No audio returned" });
  } catch (error) {
    const status = error?.message?.includes("timed out") ? 504 : 500;
    res.status(status).json({ error: error?.message || "TTS failed" });
  }
});

app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    const audioFile = req.file;
    const mimeType = req.body?.mimeType;

    if (!audioFile?.buffer) {
      res.status(400).json({ error: "No audio file provided" });
      return;
    }

    const base64Audio = audioFile.buffer.toString("base64");
    const audioMimeType = mimeType || audioFile.mimetype || "audio/webm";
    const ai = createGeminiClient();

    const response = await withTimeout(
      ai.models.generateContent({
        model: TRANSCRIBE_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: audioMimeType,
                  data: base64Audio,
                },
              },
              {
                text: "Transcribe this audio exactly as spoken. Output ONLY the transcription text, nothing else. If the audio is in Chinese, transcribe in Chinese. If in English, transcribe in English. If no speech is detected, output an empty string.",
              },
            ],
          },
        ],
      }),
      TRANSCRIBE_TIMEOUT_MS,
      "Transcription request timed out"
    );

    const transcription =
      response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    res.json({ text: transcription });
  } catch (error) {
    const status = error?.message?.includes("timed out") ? 504 : 500;
    res.status(status).json({ error: error?.message || "Transcription failed" });
  }
});

function safeSendJson(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // Ignore send errors for closed sockets.
  }
}

function normalizeWhitespace(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeAssistantText(value) {
  const raw = typeof value === "string" ? value : "";
  const withoutThoughtTags = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/\[\s*thinking[^\]]*]/gi, "")
    .trim();
  return normalizeWhitespace(withoutThoughtTags);
}

function readTranscriptionText(payload) {
  if (!payload || typeof payload !== "object") return "";
  const candidate =
    payload.text ??
    payload.transcript ??
    payload.partialText ??
    payload.partial_text;
  return normalizeWhitespace(typeof candidate === "string" ? candidate : "");
}

function readTranscriptionFinalFlag(payload) {
  if (!payload || typeof payload !== "object") return null;
  const candidate =
    payload.isFinal ??
    payload.is_final ??
    payload.finished ??
    payload.final;
  return typeof candidate === "boolean" ? candidate : null;
}



function extractTranscriptEvents(upstreamMessage) {
  const content = upstreamMessage?.serverContent ?? upstreamMessage?.server_content;
  if (!content || typeof content !== "object") {
    return [];
  }

  const events = [];
  const turnComplete = Boolean(content.turnComplete ?? content.turn_complete);

  const pushEvent = (role, text, isFinal = false) => {
    let processText = typeof text === "string" ? text : "";
    if (role === "ai") {
      processText = sanitizeAssistantText(processText);
    }
    if (!processText) return;
    events.push({ role, text: processText, isFinal: Boolean(isFinal) });
  };

  const inputTranscription = content.inputTranscription ?? content.input_transcription;
  const inputAudioTranscription =
    content.inputAudioTranscription ?? content.input_audio_transcription;
  const resolvedInputPayload = inputAudioTranscription ?? inputTranscription;
  const userText = readTranscriptionText(resolvedInputPayload);
  if (userText) {
    const explicitFinal = readTranscriptionFinalFlag(resolvedInputPayload);
    const fallbackFinal = Boolean(
      inputTranscription?.isFinal ??
      inputTranscription?.is_final ??
      inputTranscription?.finished
    );
    pushEvent("user", userText, explicitFinal ?? fallbackFinal);
  }

  const modelTurn = content.modelTurn ?? content.model_turn;
  if (modelTurn?.parts && Array.isArray(modelTurn.parts)) {
    for (const part of modelTurn.parts) {
      if (!part || typeof part !== "object") continue;
      if (part.thought || part.thoughtSignature || part.thought_signature) continue;
      if (typeof part.text !== "string") continue;
      pushEvent("ai", part.text, turnComplete);
    }
  }

  const outputTranscription = content.outputTranscription ?? content.output_transcription;
  const outputAudioTranscription =
    content.outputAudioTranscription ?? content.output_audio_transcription;
  const resolvedOutputPayload = outputAudioTranscription ?? outputTranscription;
  const aiTranscript = readTranscriptionText(resolvedOutputPayload);
  if (aiTranscript) {
    const explicitFinal = readTranscriptionFinalFlag(resolvedOutputPayload);
    pushEvent("ai", aiTranscript, explicitFinal ?? turnComplete);
  }

  const dedupedEvents = [];
  const seen = new Set();
  for (const event of events) {
    const key = `${event.role}|${event.isFinal ? "1" : "0"}|${event.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedEvents.push(event);
  }
  return dedupedEvents;
}



function setupLiveProxy(server) {
  const wss = new WebSocketServer({ server, path: LIVE_PROXY_PATH });

  wss.on("connection", (clientWs, req) => {
    const clientId = Math.random().toString(36).slice(2, 8);
    console.log(`[ws:${clientId}] client connected`, req.socket.remoteAddress);

    let geminiWs = null;
    let geminiConnected = false;
    let heartbeatTimer = null;
    const lastPartialTranscriptByRole = { user: "", ai: "" };
    let editInProgress = false;
    let editVersionCounter = 0;
    const queue = [];

    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    const startHeartbeat = () => {
      stopHeartbeat();
      heartbeatTimer = setInterval(() => {
        if (clientWs.readyState === WebSocket.OPEN) {
          try {
            clientWs.ping();
          } catch { }
        }
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
          try {
            geminiWs.ping();
          } catch { }
        }
      }, HEARTBEAT_INTERVAL_MS);
    };

    const closeBoth = (code, reason) => {
      stopHeartbeat();
      if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.close(code, reason);
      }
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(code, reason);
      }
    };

    const sendToolResponseToGemini = (functionCallId, functionCallName, responsePayload) => {
      if (!functionCallId) return;
      if (!geminiWs || geminiWs.readyState !== WebSocket.OPEN) return;
      try {
        geminiWs.send(
          JSON.stringify({
            toolResponse: {
              functionResponses: [
                {
                  id: functionCallId,
                  name: functionCallName || "edit_photo",
                  response: responsePayload,
                },
              ],
            },
          })
        );
      } catch (error) {
        console.error(`[ws:${clientId}] failed to send tool response`, error?.message);
      }
    };

    const handleConfirmEdit = async (confirmPayload) => {
      if (editInProgress) {
        return;
      }

      const imageBase64 = normalizeWhitespace(confirmPayload?.imageBase64 || "");
      const mimeType = normalizeWhitespace(confirmPayload?.mimeType || "") || "image/jpeg";
      const instruction =
        normalizeWhitespace(confirmPayload?.instruction || "");

      if (!imageBase64 || !instruction) {
        safeSendJson(clientWs, {
          type: "EDIT_FAILED",
          error: "Missing image data or edit instruction.",
        });
        return;
      }

      editInProgress = true;
      safeSendJson(clientWs, {
        type: "EDIT_STATUS",
        status: "editing",
        instruction,
      });

      try {
        const edited = await runImageEdit({
          imageBase64,
          mimeType,
          editPrompt: instruction,
        });
        editVersionCounter += 1;
        const versionLabel = `v${editVersionCounter}`;

        safeSendJson(clientWs, {
          type: "EDIT_COMPLETED",
          instruction,
          version: versionLabel,
          versionNumber: editVersionCounter,
          imageBase64: edited.imageBase64,
          mimeType: edited.mimeType,
        });
      } catch (error) {
        const message = error?.message || "Image edit failed";
        safeSendJson(clientWs, {
          type: "EDIT_FAILED",
          instruction,
          error: message,
        });
      } finally {
        editInProgress = false;
      }
    };

    let upstreamUrl;
    try {
      upstreamUrl = `${GEMINI_WS_URL}?key=${encodeURIComponent(getGeminiApiKey())}`;
    } catch (error) {
      safeSendJson(clientWs, { error: { message: error.message } });
      closeBoth(1011, error.message);
      return;
    }

    safeSendJson(clientWs, { proxy: { type: "connecting_upstream" } });
    geminiWs = new WebSocket(upstreamUrl);

    geminiWs.on("open", () => {
      geminiConnected = true;
      startHeartbeat();
      safeSendJson(clientWs, { proxy: { type: "upstream_connected" } });

      while (queue.length > 0 && geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(queue.shift());
      }
    });

    geminiWs.on("message", (data) => {
      if (clientWs.readyState !== WebSocket.OPEN) return;

      let parsed = null;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        // Binary/audio payloads may not be JSON.
      }

      clientWs.send(data);

      try {
        if (!parsed) {
          parsed = JSON.parse(data.toString());
        }
        const transcriptEvents = extractTranscriptEvents(parsed);
        for (const event of transcriptEvents) {
          if (!event.isFinal && lastPartialTranscriptByRole[event.role] === event.text) {
            continue;
          }
          safeSendJson(clientWs, { transcript: event });
          if (event.isFinal) {
            lastPartialTranscriptByRole[event.role] = "";
          } else {
            lastPartialTranscriptByRole[event.role] = event.text;
          }
        }
        if (parsed.setupComplete) {
          safeSendJson(clientWs, { proxy: { type: "ready_for_audio" } });
        }
      } catch {
        // Audio/binary payloads do not need parsing.
      }
    });

    geminiWs.on("error", (error) => {
      console.error(`[ws:${clientId}] upstream error`, error.message);
      safeSendJson(clientWs, {
        error: { message: `Proxy upstream error: ${error.message}` },
      });
      closeBoth(1011, `Gemini error: ${error.message}`);
    });

    geminiWs.on("close", (code, reason) => {
      geminiConnected = false;
      stopHeartbeat();
      const reasonText = reason?.toString() || "(no reason)";
      safeSendJson(clientWs, {
        error: { message: `Proxy upstream closed (${code}): ${reasonText}` },
      });
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(code, reasonText);
      }
    });

    clientWs.on("message", (data) => {
      let outbound = data;
      try {
        const parsed = JSON.parse(data.toString());

        if (parsed?.type === "CONFIRM_EDIT") {
          void handleConfirmEdit(parsed);
          return;
        }

        if (parsed?.type === "CANCEL_EDIT_CONFIRM") {
          safeSendJson(clientWs, { type: "EDIT_CONFIRM_CANCELLED" });
          return;
        }

        const patched = JSON.parse(data.toString());
        // Forward client setups unmodified, except verifying json parsed successfully
        outbound = JSON.stringify(patched);
      } catch {
        // Binary chunks and non-JSON payloads are forwarded unchanged.
      }

      if (geminiConnected && geminiWs?.readyState === WebSocket.OPEN) {
        geminiWs.send(outbound);
        return;
      }

      if (queue.length >= MAX_QUEUE_MESSAGES) {
        queue.shift();
      }
      queue.push(outbound);
    });

    clientWs.on("close", () => {
      stopHeartbeat();
      if (geminiWs) {
        geminiWs.close();
      }
    });

    clientWs.on("error", () => {
      stopHeartbeat();
      if (geminiWs) {
        geminiWs.close();
      }
    });
  });

  return wss;
}

async function bootstrap() {
  const server = createServer(app);
  const wsServer = setupLiveProxy(server);

  server.listen(PORT, () => {
    console.log(`✅ Backend running on http://localhost:${PORT}`);
    console.log(`✅ Storage: Supabase`);
    console.log(`✅ WebSocket proxy path: ${LIVE_PROXY_PATH}`);
    console.log(
      `✅ CORS origins: ${allowAllOrigins ? "*" : Array.from(allowedOrigins).join(", ")}`
    );
  });

  process.on("SIGTERM", () => {
    wsServer.clients.forEach((client) => {
      client.close(1001, "Server shutting down");
    });
    server.close(() => process.exit(0));
  });
}

bootstrap().catch((error) => {
  console.error("❌ Failed to start backend:", error);
  process.exit(1);
});
