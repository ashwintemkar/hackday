import { ImageExtractor } from "./image-extractor";
import type { OCRStructuredData } from "./ocr-service";

const mjAPI = {
  config: (options: any) => {},
  start: () => {},
  typeset: (options: any) => {
    return { mml: options.math };
  },
};

export class PDFService {
  private static mathJaxInitialized = false;

  private static emit(level: "log" | "warn" | "error", scope: string, ...payload: unknown[]) {
    const prefix = `[PDFService][${scope}]`;
    if (level === "warn") {
      console.warn(prefix, ...payload);
    } else if (level === "error") {
      console.error(prefix, ...payload);
    } else {
      console.log(prefix, ...payload);
    }
  }

  private static log(scope: string, ...payload: unknown[]) {
    this.emit("log", scope, ...payload);
  }

  private static warn(scope: string, ...payload: unknown[]) {
    this.emit("warn", scope, ...payload);
  }

  private static error(scope: string, ...payload: unknown[]) {
    this.emit("error", scope, ...payload);
  }

  private static initMathJax() {
    if (this.mathJaxInitialized) {
      this.log("MathJaxReuse", "MathJax already initialized for formula conversion");
      return;
    }

    this.log("MathJaxInit", "Configuring MathJax for TeX to MathML conversions");
    mjAPI.config({
      MathJax: {
        tex2jax: {
          inlineMath: [
            ["\\[", "\\]"],
            ["\\(", "\\)"],
          ],
        },
      },
    });
    mjAPI.start();
    this.mathJaxInitialized = true;
    this.log("MathJaxReady", "MathJax startup complete");
  }

  private static async processMathFormulas(
    text: string,
    traceId: string
  ): Promise<string> {
    this.initMathJax();

    const formulaRegex =
      /\$\$([\s\S]*?)\$\$|\$([\s\S]*?)\$|\\begin\{equation\}([\s\S]*?)\\end\{equation\}/g;
    const matches = [...text.matchAll(formulaRegex)];

    if (matches.length === 0) {
      this.log("MathFormulaSkip", `Job ${traceId}: No math formulas detected`);
      return text;
    }

    this.log(
      "MathFormulaQueue",
      `Job ${traceId}: Converting ${matches.length} math formula segment(s)`
    );

    let conversionErrors = 0;
    const converted = text.replace(formulaRegex, (match, group1, group2, group3) => {
      const formula = group1 || group2 || group3 || "";

      try {
        const result = mjAPI.typeset({
          math: formula,
          format: "TeX",
          mml: true,
        });

        const asciiMath = this.simplifyMathML(result.mml);
        this.log(
          "MathFormulaConverted",
          `Job ${traceId}: Converted formula snippet length ${formula.length}`
        );
        return asciiMath;
      } catch (err) {
        conversionErrors += 1;
        this.warn(
          "MathFormulaConversionFailed",
          `Job ${traceId}: Failed to convert formula snippet`,
          err
        );
        return match;
      }
    });

    if (conversionErrors > 0) {
      this.warn(
        "MathFormulaPartial",
        `Job ${traceId}: ${conversionErrors} formula conversion(s) reverted to original text`
      );
    }

    return converted;
  }

  private static simplifyMathML(mathML: string): string {
    const superscriptRegex = /<msup>(.*?)<\/msup>/g;
    const fractionRegex = /<mfrac>(.*?)<\/mfrac>/g;

    let simplified = mathML.replace(superscriptRegex, (match, content) => {
      const parts = content.split("</mrow><mrow>");
      if (parts.length === 2) {
        const base = parts[0].replace(/<mrow>/, "");
        const exponent = parts[1].replace(/<\/mrow>/, "");
        return `${base}^${exponent}`;
      }
      return match;
    });

    simplified = simplified.replace(fractionRegex, (match, content) => {
      const parts = content.split("</mrow><mrow>");
      if (parts.length === 2) {
        const numerator = parts[0].replace(/<mrow>/, "");
        const denominator = parts[1].replace(/<\/mrow>/, "");
        return `(${numerator})/(${denominator})`;
      }
      return match;
    });

    simplified = simplified.replace(/<[^>]*>/g, "");

    return simplified;
  }

  static async extractImagesAndRewritePDF(
    fileBuffer: Buffer,
    fileName: string,
    chatFolder: string
  ): Promise<{
    textBuffer: Buffer;
    extractedImages: {
      name: string;
      buffer: Buffer;
      s3Key: string;
      pageNum: number;
      ocrText?: string;
      ocrConfidence?: number;
      structuredData?: OCRStructuredData;
    }[];
  }> {
    const traceId = `pdf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    this.log(
      "ProcessStart",
      `Job ${traceId}: Processing file ${fileName} (${fileBuffer.length} bytes) for chat folder ${chatFolder}`
    );

    try {
      const { textContent, images } = await ImageExtractor.processDocumentImages(
        fileBuffer,
        fileName,
        chatFolder,
        traceId
      );

      this.log(
        "ExtractorResult",
        `Job ${traceId}: Extractor returned text length ${textContent.length} and ${images.length} image(s)`
      );

      if (images.length === 0) {
        this.log("NoImages", `Job ${traceId}: No images extracted from ${fileName}`);
      } else {
        const imagesWithOCR = images.filter((img) => img.ocr.text && img.ocr.text.length > 0);
        this.log(
          "ImageOCRStats",
          `Job ${traceId}: ${imagesWithOCR.length}/${images.length} image(s) include OCR text`
        );

        if (imagesWithOCR.length > 0) {
          this.log(
            "ImageOCRSample",
            `Job ${traceId}: Sample OCR text preview -> ${imagesWithOCR[0].ocr.text
              ?.replace(/\s+/g, " ")
              .substring(0, 120)}`
          );
        }
      }

      const processedText = await this.processMathFormulas(textContent, traceId);
      this.log(
        "ProcessTextComplete",
        `Job ${traceId}: Final text length after math normalization ${processedText.length}`
      );

      const extractedImages = images.map((img) => ({
        name: img.name,
        buffer: img.buffer,
        s3Key: img.s3Key,
        pageNum: img.pageNum,
        ocrText: img.ocr.text,
        ocrConfidence: img.ocr.confidence,
        structuredData: img.ocr.structured,
      }));

      this.log(
        "ProcessSuccess",
        `Job ${traceId}: Completed PDF rewrite with ${extractedImages.length} image artifact(s)`
      );

      return {
        textBuffer: Buffer.from(processedText, "utf-8"),
        extractedImages,
      };
    } catch (error) {
      this.error("ProcessFailure", `Job ${traceId}: Error in PDF service for ${fileName}`, error);

      return {
        textBuffer: Buffer.from(
          `[PDF PROCESSING ERROR] The document ${fileName} could not be processed properly. It may be corrupted or password-protected.`,
          "utf-8"
        ),
        extractedImages: [],
      };
    }
  }
}
