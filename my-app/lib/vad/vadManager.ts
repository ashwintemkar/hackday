import { MicVAD } from "@ricky0123/vad-web";
import type { VADConfig } from "./config";

export class VADManager {
  private vad: MicVAD | null = null;
  private isInitialized = false;

  async initialize(
    config: VADConfig,
    onSpeechStart: () => void,
    onSpeechEnd: (audio: Float32Array) => void,
    onError: (error: Error) => void
  ): Promise<void> {
    try {
      console.log("[VAD] Initializing with config:", config);

      const frameMs = config.model === "v5" ? 32 : 96;

      this.vad = await MicVAD.new({
        positiveSpeechThreshold: config.positiveSpeechThreshold,
        negativeSpeechThreshold: config.negativeSpeechThreshold,
        redemptionMs: config.redemptionFrames * frameMs,
        preSpeechPadMs: config.preSpeechPadFrames * frameMs,
        minSpeechMs: config.minSpeechFrames * frameMs,
        model: config.model,
        onSpeechStart: () => {
          console.log("[VAD] Speech detected");
          onSpeechStart();
        },
        onSpeechEnd: (audio) => {
          console.log("[VAD] Speech ended, audio length:", audio.length);
          onSpeechEnd(audio);
        },
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/vad/",
      });

      this.isInitialized = true;
      console.log("[VAD] Initialized successfully");
    } catch (error) {
      console.error("[VAD] Initialization failed:", error);
      onError(error as Error);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (!this.vad || !this.isInitialized) {
      throw new Error("VAD not initialized");
    }
    console.log("[VAD] Starting...");
    await this.vad.start();
  }

  async pause(): Promise<void> {
    if (!this.vad) return;
    console.log("[VAD] Pausing...");
    await this.vad.pause();
  }

  async destroy(): Promise<void> {
    if (!this.vad) return;
    console.log("[VAD] Destroying...");
    this.vad.destroy();
    this.vad = null;
    this.isInitialized = false;
  }

  isActive(): boolean {
    return this.isInitialized && this.vad !== null;
  }
}
