import fs from "fs";
import path from "path";
import * as pdfParse from "pdf-parse";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf";
import sharp from "sharp";
import { DocumentInitParameters } from "pdfjs-dist/types/src/display/api";
import { S3Service } from "./s3-service";
import { OCRResult, OCRService } from "./ocr-service";

const workerPath = path.resolve(
  process.cwd(),
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.js"
);

if (fs.existsSync(workerPath)) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
} else {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.12.313/pdf.worker.min.js";
}

interface ExtractedImage {
  buffer: Buffer;
  pageNum: number;
  index: number;
}

interface ProcessedImage {
  name: string;
  buffer: Buffer;
  s3Key: string;
  pageNum: number;
  index: number;
  ocr: OCRResult;
}

export class ImageExtractor {
  private static emit(
    level: "log" | "warn" | "error",
    scope: string,
    ...payload: unknown[]
  ) {
    const prefix = `[ImageExtractor][${scope}]`;
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

  private static createTraceId(prefix: string) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
  }

  static async processDocumentImages(
    fileBuffer: Buffer,
    fileName: string,
    chatFolder: string,
    parentTraceId?: string
  ): Promise<{
    textContent: string;
    images: ProcessedImage[];
  }> {
    const traceId = parentTraceId ?? this.createTraceId("doc");
    const fileExtension = fileName.split(".").pop()?.toLowerCase() || "";

    this.log(
      "ProcessDocumentStart",
      `Job ${traceId}: Received ${fileName} (${fileBuffer.length} bytes, ext=${fileExtension}) for chat folder ${chatFolder}`
    );

    if (fileExtension === "pdf") {
      this.log("ProcessDocumentPDF", `Job ${traceId}: Routing to PDF pipeline`);
      return this.processPDF(fileBuffer, fileName, chatFolder, traceId);
    }

    if (this.isImageFile(fileExtension)) {
      this.log(
        "ProcessDocumentImage",
        `Job ${traceId}: Routing to image pipeline`
      );
      return this.processImageFile(
        fileBuffer,
        fileName,
        fileExtension,
        traceId
      );
    }

    this.warn(
      "ProcessDocumentFallback",
      `Job ${traceId}: Unrecognized extension '${fileExtension}'. Treating as plain text.`
    );

    return {
      textContent: fileBuffer.toString("utf-8"),
      images: [],
    };
  }

  private static async processPDF(
    pdfBuffer: Buffer,
    fileName: string,
    chatFolder: string,
    traceId?: string
  ): Promise<{
    textContent: string;
    images: ProcessedImage[];
  }> {
    const jobId = traceId ?? this.createTraceId("pdf");
    const processedImages: ProcessedImage[] = [];
    let textContent = "";

    try {
      const { version } = await this.detectPDFProperties(pdfBuffer, jobId);
      this.log(
        "ProcessPDFStart",
        `Job ${jobId}: Processing PDF ${fileName}, reported version ${version}`
      );

      textContent = await this.extractPdfText(pdfBuffer, fileName, jobId);
      const extractedImages = await this.extractImagesUsingPDFJS(
        pdfBuffer,
        jobId
      );
      this.log(
        "ProcessPDFImageCount",
        `Job ${jobId}: Extracted ${extractedImages.length} raw image(s) from PDF`
      );

      for (const image of extractedImages) {
        const processed = await this.processSingleImage(
          image,
          fileName,
          chatFolder,
          jobId
        );
        if (processed) {
          processedImages.push(processed);
        }
      }

      textContent = this.injectImagesIntoText(
        textContent,
        processedImages,
        fileName,
        jobId
      );
    } catch (error) {
      this.error(
        "ProcessPDFError",
        `Job ${jobId}: Error processing PDF`,
        error
      );
      if (!textContent) {
        textContent = `Error processing PDF document '${fileName}'. The file may be corrupted or password-protected.`;
      }
    }

    this.log(
      "ProcessPDFComplete",
      `Job ${jobId}: Completed PDF pipeline with ${processedImages.length} processed image(s) and text length ${textContent.length}`
    );
    return {
      textContent,
      images: processedImages,
    };
  }

  private static async processImageFile(
    fileBuffer: Buffer,
    fileName: string,
    extension: string,
    traceId?: string
  ): Promise<{ textContent: string; images: ProcessedImage[] }> {
    const jobId = traceId ?? this.createTraceId("img");

    if (extension === "svg") {
      const svgContent = fileBuffer.toString("utf-8").trim();
      this.log(
        "ProcessImageSVG",
        `Job ${jobId}: Processing SVG upload ${fileName} (length ${svgContent.length})`
      );

      return {
        textContent:
          svgContent.length > 0
            ? `[SVG_UPLOAD:${fileName}]\n${svgContent}`
            : `[SVG_UPLOAD:${fileName}]\n[SVG_FILE_CONTAINED_NO_TEXT]`,
        images: [],
      };
    }

    try {
      this.log(
        "ProcessImageOCRStart",
        `Job ${jobId}: Performing direct OCR on image upload ${fileName}`
      );
      const ocr = await OCRService.extractTextFromImage(fileBuffer);
      const text = ocr.text.trim();
      this.log(
        "ProcessImageOCREnd",
        `Job ${jobId}: OCR returned ${
          text.length
        } characters with ${ocr.confidence.toFixed(2)}% confidence`
      );

      if (text.length === 0) {
        this.warn(
          "ProcessImageNoText",
          `Job ${jobId}: No text detected for ${fileName}`
        );
        return {
          textContent: `[IMAGE_UPLOAD:${fileName}]\n[NO_TEXT_DETECTED_FROM_IMAGE]`,
          images: [],
        };
      }

      this.log(
        "ProcessImageSuccess",
        `Job ${jobId}: Returning OCR text for ${fileName} (length ${text.length})`
      );
      return {
        textContent: `[IMAGE_UPLOAD:${fileName}]\n${text}`,
        images: [],
      };
    } catch (error) {
      this.error(
        "ProcessImageError",
        `Job ${jobId}: Failed to process image file ${fileName}`,
        error
      );
      return {
        textContent: `[IMAGE_UPLOAD:${fileName}]\n[IMAGE_PROCESSING_FAILED]`,
        images: [],
      };
    }
  }

  private static async extractPdfText(
    pdfBuffer: Buffer,
    fileName: string,
    traceId?: string
  ): Promise<string> {
    const jobId = traceId ?? this.createTraceId("text");
    try {
      const parsedPdf = await pdfParse(pdfBuffer, {
        max: 0,
        pagerender: undefined,
        version: "v2.0.550",
      });

      this.log(
        "ExtractPdfTextSuccess",
        `Job ${jobId}: Parsed text for ${fileName} with length ${parsedPdf.text.length}`
      );
      return parsedPdf.text;
    } catch (error) {
      this.error(
        "ExtractPdfTextError",
        `Job ${jobId}: Error parsing PDF content for ${fileName}`,
        error
      );
      return `[DOCUMENT TEXT EXTRACTION FAILED: ${fileName}]\n\nThis PDF could not be properly parsed. It may be corrupted, password-protected, or use unsupported features.`;
    }
  }

  private static async processSingleImage(
    image: ExtractedImage,
    fileName: string,
    chatFolder: string,
    traceId?: string
  ): Promise<ProcessedImage | null> {
    const jobId = traceId ?? this.createTraceId("imgproc");
    try {
      const imgName = `${fileName.replace(/\.[^/.]+$/, "")}_p${
        image.pageNum
      }_img${image.index}.png`;
      this.log(
        "ProcessSingleImageStart",
        `Job ${jobId}: Preparing ${imgName} from page ${image.pageNum} (index ${image.index})`
      );

      const s3Key = await S3Service.uploadImage(
        image.buffer,
        imgName,
        chatFolder
      );
      this.log(
        "ProcessSingleImageUploaded",
        `Job ${jobId}: Uploaded ${imgName} to S3 key ${s3Key}`
      );

      const ocr = await OCRService.extractTextFromImage(image.buffer);
      this.log(
        "ProcessSingleImageOCR",
        `Job ${jobId}: OCR for ${imgName} yielded ${
          ocr.text.length
        } characters @ ${ocr.confidence.toFixed(2)}%`
      );

      return {
        name: imgName,
        buffer: image.buffer,
        s3Key,
        pageNum: image.pageNum,
        index: image.index,
        ocr,
      };
    } catch (error) {
      this.error(
        "ProcessSingleImageError",
        `Job ${jobId}: Error processing image from page ${image.pageNum}`,
        error
      );
      return null;
    }
  }

  private static injectImagesIntoText(
    textContent: string,
    images: ProcessedImage[],
    fileName: string,
    traceId?: string
  ): string {
    const jobId = traceId ?? this.createTraceId("inject");
    if (images.length === 0) {
      this.log(
        "InjectSkip",
        `Job ${jobId}: No images to inject for ${fileName}`
      );
      return textContent;
    }

    if (!textContent || textContent.trim().length === 0) {
      this.log(
        "InjectImageOnly",
        `Job ${jobId}: No base text detected for ${fileName}. Building image-only document.`
      );
      return this.buildImageOnlyDocument(images, fileName, jobId);
    }

    this.log(
      "InjectStart",
      `Job ${jobId}: Injecting ${images.length} image(s) into extracted text for ${fileName}`
    );

    const pages = textContent.split(/\f|\n{2,}/);
    const imagesByPage = this.groupImagesByPage(images);

    Object.entries(imagesByPage).forEach(([pageNumStr, pageImages]) => {
      const pageIndex = parseInt(pageNumStr, 10) - 1;

      if (pageIndex < 0 || pageIndex >= pages.length) {
        this.warn(
          "InjectOutOfBounds",
          `Job ${jobId}: Page index ${pageIndex} out of bounds for ${fileName}, skipping ${pageImages.length} image(s)`
        );
        return;
      }

      const pageText = pages[pageIndex] ?? "";

      if (pageText.trim().length === 0) {
        pages[pageIndex] = pageImages
          .map((img, idx) => this.buildImageInlineBlock(img, idx + 1))
          .join("\n\n");
        this.log(
          "InjectEmptyPage",
          `Job ${jobId}: Page ${
            pageIndex + 1
          } empty. Replaced with image-only blocks (${pageImages.length}).`
        );
        return;
      }

      const pageLength = Math.max(pageText.length, 1);
      const sectionLength = Math.floor(pageLength / (pageImages.length + 1));

      let modifiedPageText = "";
      let lastPosition = 0;

      pageImages.forEach((img, idx) => {
        const insertPosition =
          sectionLength > 0
            ? Math.min(pageLength, sectionLength * (idx + 1))
            : lastPosition;

        const textChunk = pageText.substring(lastPosition, insertPosition);
        modifiedPageText += textChunk;

        if (!textChunk.endsWith("\n")) {
          modifiedPageText += "\n";
        }

        modifiedPageText += this.buildImageInlineBlock(img);
        modifiedPageText += "\n";
        lastPosition = insertPosition;
      });

      modifiedPageText += pageText.substring(lastPosition);
      pages[pageIndex] = modifiedPageText;
      this.log(
        "InjectPageComplete",
        `Job ${jobId}: Completed inline injection for page ${
          pageIndex + 1
        } with ${pageImages.length} image(s)`
      );
    });

    this.log(
      "InjectComplete",
      `Job ${jobId}: Finished image injection for ${fileName}`
    );
    return pages.join("\n\n");
  }

  private static buildImageOnlyDocument(
    images: ProcessedImage[],
    fileName: string,
    traceId?: string
  ): string {
    const jobId = traceId ?? this.createTraceId("image-only");
    const sortedImages = [...images].sort((a, b) => {
      if (a.pageNum === b.pageNum) {
        return a.index - b.index;
      }
      return a.pageNum - b.pageNum;
    });

    const blocks = sortedImages
      .map((img, idx) => this.buildImageInlineBlock(img, idx + 1))
      .join("\n\n");

    this.log(
      "BuildImageOnlyDocument",
      `Job ${jobId}: Created image-only document for ${fileName} with ${sortedImages.length} image(s)`
    );

    return `[DOCUMENT TEXT EXTRACTION WARNING: ${fileName}]\nNo selectable text was detected in this PDF. OCR outputs from embedded images follow:\n\n${blocks}`;
  }

  private static buildImageInlineBlock(
    image: ProcessedImage,
    orderOverride?: number
  ): string {
    const lines: string[] = [
      `[IMAGE_REF:${image.s3Key}]`,
      `PAGE:${image.pageNum}`,
      `ORDER:${orderOverride ?? image.index + 1}`,
      `OCR_CONFIDENCE:${image.ocr.confidence.toFixed(1)}%`,
    ];

    const trimmedText = image.ocr.text.trim();
    if (trimmedText.length > 0) {
      lines.push("[IMAGE_OCR_TEXT]");
      lines.push(trimmedText);
      lines.push("[END_IMAGE_OCR_TEXT]");
    } else {
      lines.push("[IMAGE_OCR_TEXT:EMPTY]");
    }

    lines.push("[END_IMAGE_DATA]");

    return lines.join("\n");
  }

  private static async extractImagesUsingPDFJS(
    pdfBuffer: Buffer,
    traceId?: string
  ): Promise<ExtractedImage[]> {
    const jobId = traceId ?? this.createTraceId("pdfjs");
    const extractedImages: ExtractedImage[] = [];
    const failureReasons: Record<string, number> = {};

    try {
      this.log(
        "ExtractImagesStart",
        `Job ${jobId}: Starting pdf.js extraction`
      );
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(pdfBuffer),
        disableFontFace: true,
        nativeImageDecoderSupport: "none",
        ignoreErrors: true,
        isEvalSupported: false,
        useSystemFonts: false,
        verbosity: 0,
      } as DocumentInitParameters);

      const pdfDoc = await loadingTask.promise;
      this.log(
        "ExtractImagesDocument",
        `Job ${jobId}: PDF has ${pdfDoc.numPages} page(s)`
      );

      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        try {
          const page = await pdfDoc.getPage(pageNum);
          const operatorList = await page.getOperatorList();
          let imgIndex = 0;

          for (let i = 0; i < operatorList.fnArray.length; i++) {
            const op = operatorList.fnArray[i];
            const args = operatorList.argsArray[i];

            if (
              op === pdfjsLib.OPS.paintImageXObject ||
              op === pdfjsLib.OPS.paintImageXObjectRepeat ||
              op === pdfjsLib.OPS.paintJpegXObject
            ) {
              const imgRef = Array.isArray(args) ? args[0] : args;
              if (!imgRef) {
                continue;
              }

              try {
                const img = await this.fetchImageObject(page, imgRef, jobId);

                this.log(
                  "ExtractImageProps",
                  `Job ${jobId}: Image ${imgRef} on page ${pageNum} - width:${img?.width} height:${img?.height} kind:${img?.kind} dataLength:${img?.data?.length}`
                );

                const buffer = await this.bufferFromImageData(img, jobId);

                if (!buffer) {
                  failureReasons["invalid_image_data"] =
                    (failureReasons["invalid_image_data"] || 0) + 1;
                  continue;
                }

                extractedImages.push({
                  buffer,
                  pageNum,
                  index: imgIndex++,
                });

                this.log(
                  "ExtractImageSuccess",
                  `Job ${jobId}: Successfully extracted image ${imgIndex} from page ${pageNum} (${buffer.length} bytes)`
                );
              } catch (error) {
                const reason =
                  error instanceof Error ? error.message : "unknown_error";
                failureReasons[reason] = (failureReasons[reason] || 0) + 1;
                this.error(
                  "ExtractImagesXObjectError",
                  `Job ${jobId}: Error processing image ${imgRef} on page ${pageNum}`,
                  error
                );
              }
            } else if (op === pdfjsLib.OPS.paintInlineImageXObject) {
              try {
                const inlineImage = Array.isArray(args) ? args[0] : args;
                const buffer = await this.bufferFromImageData(
                  inlineImage,
                  jobId
                );

                if (!buffer) {
                  failureReasons["invalid_inline_image"] =
                    (failureReasons["invalid_inline_image"] || 0) + 1;
                  continue;
                }

                extractedImages.push({
                  buffer,
                  pageNum,
                  index: imgIndex++,
                });
              } catch (error) {
                const reason =
                  error instanceof Error ? error.message : "inline_error";
                failureReasons[reason] = (failureReasons[reason] || 0) + 1;
                this.error(
                  "ExtractImagesInlineError",
                  `Job ${jobId}: Error processing inline image on page ${pageNum}`,
                  reason
                );
              }
            }
          }
        } catch (pageError) {
          this.error(
            "ExtractImagesPageError",
            `Job ${jobId}: Error processing page ${pageNum}`,
            (pageError as Error).message
          );
        }
      }

      if (extractedImages.length === 0 && Object.keys(failureReasons).length) {
        this.warn(
          "ExtractImagesFailures",
          `Job ${jobId}: Image extraction produced no results`,
          failureReasons
        );
      }
    } catch (error) {
      this.error(
        "ExtractImagesUnhandled",
        `Job ${jobId}: Error extracting images from PDF`,
        error
      );
    }

    this.log(
      "ExtractImagesComplete",
      `Job ${jobId}: Returning ${extractedImages.length} image(s) with ${
        Object.keys(failureReasons).length
      } failure reason(s)`
    );
    return extractedImages;
  }

  private static async fetchImageObject(
    page: pdfjsLib.PDFPageProxy,
    imgRef: string,
    traceId?: string,
    timeoutMs = 5000
  ): Promise<any> {
    const jobId = traceId ?? this.createTraceId("imgref");
    const objStore = (page as any).objs;

    if (objStore?.has(imgRef)) {
      this.log(
        "FetchImageObjectCacheHit",
        `Job ${jobId}: Using cached image object ${imgRef}`
      );
      return objStore.get(imgRef);
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          const error = new Error(`Timeout waiting for image object ${imgRef}`);
          this.warn(
            "FetchImageObjectTimeout",
            `Job ${jobId}: Timed out waiting for ${imgRef}`
          );
          reject(error);
        }
      }, timeoutMs);

      objStore?.get(imgRef, (data: any) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        this.log(
          "FetchImageObjectResolved",
          `Job ${jobId}: Resolved deferred image object ${imgRef}`
        );
        resolve(data);
      });
    });
  }

  private static async bufferFromImageData(
    image: any,
    traceId?: string
  ): Promise<Buffer | null> {
    const jobId = traceId ?? this.createTraceId("imgdata");
    if (!image) {
      this.warn(
        "BufferFromImageMissing",
        `Job ${jobId}: Image object is null or undefined`
      );
      return null;
    }

    if (image.data && Buffer.isBuffer(image.data) && !image.width) {
      this.log(
        "BufferFromImageDirect",
        `Job ${jobId}: Using direct image buffer (${image.data.length} bytes)`
      );
      return image.data;
    }

    if (!image.data || !image.width || !image.height) {
      this.warn(
        "BufferFromImageMissing",
        `Job ${jobId}: Image data missing required fields`
      );
      return null;
    }

    const imgData =
      image.data instanceof Uint8ClampedArray
        ? Buffer.from(image.data.buffer)
        : Buffer.from(image.data);

    if (
      !this.isValidImage(image.width, image.height, imgData, image.kind, jobId)
    ) {
      return null;
    }

    return this.createImage(
      image.width,
      image.height,
      imgData,
      image.kind,
      jobId
    );
  }

  private static async createImage(
    width: number,
    height: number,
    data: Buffer,
    kind: any,
    traceId?: string
  ): Promise<Buffer | null> {
    const jobId = traceId ?? this.createTraceId("sharp");

    try {
      try {
        const metadata = await sharp(data).metadata();
        if (metadata.width && metadata.height) {
          const buffer = await sharp(data).png().toBuffer();
          this.log(
            "CreateImageFromEncoded",
            `Job ${jobId}: Converted encoded image to PNG (${buffer.length} bytes)`
          );
          return buffer;
        }
      } catch {
        // Not a complete image, continue to raw processing
      }

      let channels = this.resolveChannelCount(kind);
      let expectedSize = width * height * channels;

      if (Math.abs(data.length - expectedSize) > 100) {
        this.log(
          "CreateImageAutoDetect",
          `Job ${jobId}: Data size ${data.length} doesn't match expected ${expectedSize} (${width}×${height}×${channels}), auto-detecting...`
        );

        for (const tryChannels of [3, 4, 1]) {
          // the validation was expecting 80% of width and height and channel bytes but PDF images were compressed 14-11-25
          const tryExpected = width * height * tryChannels;
          if (Math.abs(data.length - tryExpected) <= 100) {
            channels = tryChannels as 1 | 3 | 4;
            this.log(
              "CreateImageAutoDetectSuccess",
              `Job ${jobId}: Auto-detected ${channels} channels (expected ${tryExpected}, actual ${data.length})`
            );
            break;
          }
        }
      }

      return this.createImageWithChannels(width, height, data, channels, jobId);
    } catch (error) {
      this.error(
        "CreateImageError",
        `Job ${jobId}: Error creating image buffer`,
        error
      );
      return null;
    }
  }

  private static async createImageWithChannels(
    width: number,
    height: number,
    data: Buffer,
    channels: 1 | 3 | 4,
    traceId?: string
  ): Promise<Buffer | null> {
    const jobId = traceId ?? this.createTraceId("sharp-raw");

    try {
      const buffer = await sharp(data, {
        raw: {
          width,
          height,
          channels,
        },
      })
        .ensureAlpha()
        .png()
        .toBuffer();

      this.log(
        "CreateImageSuccess",
        `Job ${jobId}: Created PNG buffer ${buffer.length} bytes (${width}x${height}, channels=${channels})`
      );
      return buffer;
    } catch (error) {
      this.error(
        "CreateImageChannelError",
        `Job ${jobId}: Failed with ${channels} channels`,
        error
      );
      return null;
    }
  }

  private static isValidImage(
    width: number,
    height: number,
    data: Buffer,
    kind: any,
    traceId?: string
  ): boolean {
    const jobId = traceId ?? this.createTraceId("img-validate");
    if (width < 10 || height < 10) {
      this.warn(
        "ImageValidationSize",
        `Job ${jobId}: Rejecting image with small dimensions ${width}x${height}`
      );
      return false;
    }

    const minDataSize = Math.min((width * height) / 10, 1000);

    if (data.length < minDataSize) {
      this.warn(
        "ImageValidationData",
        `Job ${jobId}: Rejecting image due to insufficient data (have ${data.length}, min ${minDataSize})`
      );
      return false;
    }

    this.log(
      "ImageValidationPass",
      `Job ${jobId}: Image validated ${width}x${height} with ${data.length} bytes`
    );
    return true;
  }

  private static resolveChannelCount(kind: any): 1 | 3 | 4 {
    const imageKind = (pdfjsLib as any).ImageKind;

    if (typeof kind === "number" && imageKind) {
      switch (kind) {
        case imageKind.GRAYSCALE_1BPP:
        case imageKind.GRAYSCALE_2BPP:
        case imageKind.GRAYSCALE_4BPP:
          return 1;
        case imageKind.RGB_24BPP:
        case imageKind.RGB:
          return 3;
        case imageKind.RGBA_32BPP:
          return 4;
        default:
          if (kind === 1) return 1;
          if (kind === 2) return 3;
          if (kind === 3) return 4;
          return 4;
      }
    }

    if (typeof kind === "string") {
      const normalized = kind.toUpperCase();
      if (normalized.includes("GRAY")) return 1;
      if (normalized.includes("RGBA")) return 4;
      if (normalized.includes("RGB")) return 3;
    }
    return 3;
  }

  private static groupImagesByPage(
    images: ProcessedImage[]
  ): Record<number, ProcessedImage[]> {
    const grouped = images.reduce((acc, img) => {
      acc[img.pageNum] = acc[img.pageNum] || [];
      acc[img.pageNum].push(img);
      return acc;
    }, {} as Record<number, ProcessedImage[]>);

    Object.values(grouped).forEach((list) =>
      list.sort((a, b) => a.index - b.index)
    );

    return grouped;
  }

  private static async detectPDFProperties(
    pdfBuffer: Buffer,
    traceId?: string
  ): Promise<{
    version: string;
    canProcess: boolean;
  }> {
    const jobId = traceId ?? this.createTraceId("pdf-prop");
    try {
      const header = pdfBuffer.toString("utf8", 0, 8);
      if (!header.startsWith("%PDF-")) {
        this.warn(
          "DetectPDFPropertiesInvalid",
          `Job ${jobId}: Buffer missing PDF header signature`
        );
        return { version: "unknown", canProcess: false };
      }

      const version = header.substring(5, 8);
      const numVersion = parseFloat(version);
      const canFullyProcess = numVersion <= 1.7;

      this.log(
        "DetectPDFProperties",
        `Job ${jobId}: Detected version ${version} (canProcess=${canFullyProcess})`
      );
      return {
        version,
        canProcess: canFullyProcess,
      };
    } catch (error) {
      this.error(
        "DetectPDFPropertiesError",
        `Job ${jobId}: Error detecting PDF properties`,
        error
      );
      return { version: "unknown", canProcess: false };
    }
  }

  private static isImageFile(ext: string): boolean {
    return [
      "png",
      "jpg",
      "jpeg",
      "gif",
      "bmp",
      "webp",
      "tif",
      "tiff",
      "svg",
    ].includes(ext);
  }
}
