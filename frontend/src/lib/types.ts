export interface User {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
}

export interface UserProfile {
  userId: string;
  name: string;
  hobbies: string[];
  selfIntro: string;
  preferences: Record<string, string>;
  conversationSummaries: string[];
  onboardingComplete: boolean;
}

export interface ImageVersion {
  dataUrl: string;
  editPrompt: string;
  timestamp: number;
}

export interface ChatMessage {
  role: "user" | "model";
  text: string;
}

export type PhotoAgeBucket =
  | "unknown"
  | "within_1_year"
  | "one_to_five_years"
  | "five_to_ten_years"
  | "ten_plus_years";

export interface PhotoTimeContext {
  sourceText: string;
  timeDescription: string;
  ageBucket: PhotoAgeBucket;
  approxYears: number | null;
}

export interface Conversation {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  imageDataUrl: string;
  imageMimeType: string;
  imageVersions: ImageVersion[];
  messages: ChatMessage[];
}
