export interface VADConfig {
  positiveSpeechThreshold: number;
  negativeSpeechThreshold: number;
  redemptionFrames: number;
  preSpeechPadFrames: number;
  minSpeechFrames: number;
  model: "v5";
}

export const DEFAULT_VAD_CONFIG: VADConfig = {
  positiveSpeechThreshold: 0.7, // Reduced from 0.8 for better sensitivity
  negativeSpeechThreshold: 0.4, // Reduced from 0.5
  redemptionFrames: 90, // Increased from 62 - waits ~2.8 seconds of silence
  preSpeechPadFrames: 1,
  minSpeechFrames: 8, // Reduced from 10
  model: "v5",
};

export const BARGE_IN_VAD_CONFIG: VADConfig = {
  positiveSpeechThreshold: 0.85, // Much higher threshold
  negativeSpeechThreshold: 0.6, // Higher to reduce sensitivity
  redemptionFrames: 45, // Longer silence needed
  preSpeechPadFrames: 1,
  minSpeechFrames: 8, // More frames required
  model: "v5",
};

export const IDLE_TIMEOUT_MS = 30000; // 30 seconds
