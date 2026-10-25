import { createWorker } from "tesseract.js";

export type OCRStructuredData = {
  blocks?: any[];
  lines?: any[];
  words?: any[];
};

export type OCRResult = {
  text: string;
  confidence: number;
  structured?: OCRStructuredData;
};

export class OCRService {
  private static workerPromise: Promise<any> | null = null;
  private static worker: any | null = null;

  private static async getWorker() {
    if (this.worker) {
      return this.worker;
    }

    if (!this.workerPromise) {
      this.workerPromise = (async () => {
        const worker = await createWorker(
          "eng",
          undefined,
          {
            logger: () => {},
          }
        );
        this.worker = worker;
        this.workerPromise = null;
        return worker;
      })();
    }

    return this.workerPromise;
  }

  static async extractTextFromImage(buffer: Buffer): Promise<OCRResult> {
    try {
      const worker = await this.getWorker();
      const { data } = await worker.recognize(buffer);

      return {
        text: data?.text?.trim?.() || "",
        confidence: typeof data?.confidence === "number" ? data.confidence : 0,
        structured: {
          blocks: data?.blocks,
          lines: data?.lines,
          words: data?.words,
        },
      };
    } catch (error) {
      console.error("[OCRService] Error during OCR:", error);
      return { text: "", confidence: 0, structured: {} };
    }
  }

  static async terminate() {
    try {
      if (this.worker) {
        await this.worker.terminate();
      }
    } catch (error) {
      console.warn("[OCRService] Failed to terminate worker", error);
    } finally {
      this.worker = null;
      this.workerPromise = null;
    }
  }
}
