import type { NextApiRequest, NextApiResponse } from "next";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

export const config = {
  api: { responseLimit: false },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }

  const { text, voice = "en_US-lessac-medium" } = req.body || {};

  if (!text) {
    return res.status(400).json({ error: "Missing text" });
  }

  try {
    const projectRoot = process.cwd();
    const defaultModelName = `${voice}.onnx`.replace(/\.onnx\.onnx$/, ".onnx");
    const modelPath = path.isAbsolute(voice)
      ? voice
      : path.join(projectRoot, "voices", voice.endsWith(".onnx") ? voice : defaultModelName);

    // Windows-aware Piper binary detection with proper PATH resolution
    const isWindows = process.platform === "win32";
    const piperBinName = isWindows ? "piper.exe" : "piper";
    const defaultPiperPath = path.join(projectRoot, "piper-bin", piperBinName);

    let piperBin: string | null = null;

    // Priority 1: Environment variable
    if (process.env.PIPER_BIN && fs.existsSync(process.env.PIPER_BIN)) {
      piperBin = process.env.PIPER_BIN;
      console.log("[TTS] Using Piper from env:", piperBin);
    }
    // Priority 2: Local piper-bin directory
    else if (fs.existsSync(defaultPiperPath)) {
      piperBin = defaultPiperPath;
      console.log("[TTS] Using Piper from local:", piperBin);
    }
    // Priority 3: Try to find in system PATH
    else {
      try {
        const { execSync } = require("child_process");
        const findCommand = isWindows ? "where piper.exe" : "which piper";
        const result = execSync(findCommand, { encoding: "utf8" }).trim();
        if (result && fs.existsSync(result.split("\n")[0])) {
          piperBin = result.split("\n")[0];
          console.log("[TTS] Using Piper from PATH:", piperBin);
        }
      } catch {
        console.log("[TTS] Piper not found in PATH");
      }
    }

    console.log("[TTS] Model path:", modelPath);
    console.log("[TTS] Model exists:", fs.existsSync(modelPath));
    console.log("[TTS] Piper binary:", piperBin);
    console.log("[TTS] Binary exists:", piperBin ? fs.existsSync(piperBin) : false);

    // Check if both binary and model exist
    const binaryExists = piperBin && fs.existsSync(piperBin);
    const modelExists = fs.existsSync(modelPath);

    if (!binaryExists || !modelExists) {
      console.warn("[TTS] Piper not available, falling back to browser TTS");
      console.warn(`[TTS] Binary available: ${binaryExists}, Model available: ${modelExists}`);
      
      if (!binaryExists) {
        console.warn("[TTS] To use Piper TTS:");
        console.warn("[TTS] 1. Download from: https://github.com/rhasspy/piper/releases");
        console.warn("[TTS] 2. Place piper.exe in: " + defaultPiperPath);
        console.warn("[TTS] 3. Or set PIPER_BIN environment variable");
      }
      
      res.setHeader("Content-Type", "audio/pcm");
      res.setHeader("X-TTS-Fallback", "true");
      res.status(200).end(Buffer.alloc(0));
      return;
    }

    const resolvedPiperBin = piperBin as string;
    const piper = spawn(resolvedPiperBin, ["--model", modelPath, "--output-raw"], {
      cwd: projectRoot,
    });

    // Stream PCM audio back to the client
    res.setHeader("Content-Type", "audio/pcm");
    res.setHeader("Transfer-Encoding", "chunked");

    piper.stdin.write(text);
    piper.stdin.end();

    piper.stdout.pipe(res);

    piper.stderr.on("data", (data) => {
      console.error("[Piper]", data.toString());
    });

    piper.on("close", (code) => {
      console.log(`[Piper] Process exited with code ${code}`);
      if (!res.writableEnded) {
        res.end();
      }
    });

    piper.on("error", (err) => {
      console.error("[Piper] Error:", err);
      if (!res.headersSent) {
        res.setHeader("X-TTS-Fallback", "true");
        res.status(200).end(Buffer.alloc(0));
      }
    });
  } catch (err: any) {
    console.error("[TTS] Error:", err);
    // Return empty buffer instead of error to allow fallback
    if (!res.headersSent) {
      res.setHeader("Content-Type", "audio/pcm");
      res.setHeader("X-TTS-Fallback", "true");
      res.status(200).end(Buffer.alloc(0));
    }
  }
}
