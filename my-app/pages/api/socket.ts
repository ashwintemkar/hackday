import type { NextApiRequest } from "next";
import type { NextApiResponse } from "next";
import { randomUUID } from "crypto";
import { Server as IOServer } from "socket.io";
import { Server as HTTPServer } from "http";
import { Socket as NetSocket } from "net";
import { queryChatAndAnswer } from "@/lib/pgvector/query";
import { prisma } from "@/lib/prisma";
import WebSocket from "ws";

export const config = {
  api: {
    bodyParser: false,
  },
};

type VoiceState = "idle" | "listening" | "processing" | "speaking" | "interrupted" | "error" | "thinking";

type VoiceSession = {
  id: string;
  chatId?: string;
  userId?: string;
  status: VoiceState;
  audioChunks: Buffer[];
  lastTranscription?: string;
  abortPlayback?: AbortController;
  bargeInDetected?: boolean;
};

type SocketDataEvent = {
  sessionId: string;
  chatId?: string;
  userId?: string;
  audio?: string;
  voice?: string;
  speed?: number;
};

type ServerWithIO = HTTPServer & {
  io?: IOServer;
};

type ResponseWithSocket = NextApiResponse & {
  socket: NetSocket & {
    server: ServerWithIO;
  };
};

type ClientSocket = IOServer["sockets"]["adapter"]["nsp"]["sockets"][string];

const voiceSessionStore = new Map<string, VoiceSession>();
const processingLocks = new Map<string, boolean>();

const RAG_FALLBACK_MESSAGES = {
  knowledgeUnavailable:
    "I'm having trouble reaching our knowledge base right now, but I'm still here if you'd like to keep chatting or try again in a bit.",
  generic:
    "I couldn't pull the right details just now. Could you try rephrasing or asking again in a moment?",
};

const TRANSCRIPTION_FALLBACK_RESPONSE =
  "I didn't quite catch that. Could you please try saying it again?";

const CHAT_FALLBACK_RESPONSE =
  "I don't have enough information to answer that right now. Please try rephrasing the question or share more detail.";

// Default Cartesia voice IDs if none is provided from client or env.
// Primary: Katie (stable), Secondary: Kiefer, Tertiary: Tessa.
const DEFAULT_CARTESIA_VOICE_ID = "f786b574-daa5-4673-aa0c-cbe3e8534c02"; // Katie

type RagFallbackReason = "pinecone_connection_error" | "rag_failure" | "empty_response" | "no_transcription";

const isPineconeConnectionError = (err: unknown) =>
  Boolean(
    err &&
      typeof err === "object" &&
      "name" in err &&
      typeof (err as { name: unknown }).name === "string" &&
      (err as { name: string }).name.includes("PineconeConnectionError")
  );

const getRagFallbackResponse = (
  err: unknown
): { text: string; reason: RagFallbackReason } => {
  if (isPineconeConnectionError(err)) {
    return { text: RAG_FALLBACK_MESSAGES.knowledgeUnavailable, reason: "pinecone_connection_error" };
  }
  return { text: RAG_FALLBACK_MESSAGES.generic, reason: "rag_failure" };
};

const enqueueAudioChunk = (sessionId: string, chunk: Buffer) => {
  const session = voiceSessionStore.get(sessionId);
  if (!session) return;
  session.audioChunks.push(chunk);
};

const clearSessionAudio = (sessionId: string) => {
  const session = voiceSessionStore.get(sessionId);
  if (!session) return;
  session.audioChunks = [];
};

const setSessionState = (sessionId: string, status: VoiceState) => {
  const session = voiceSessionStore.get(sessionId);
  if (!session) return;
  session.status = status;
};

// Inspect buffered PCM audio to confirm it looks valid before sending to ASR
function verifyAudioFormat(audioChunks: Buffer[], sessionId: string) {
  const totalBytes = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const totalSamples = totalBytes / 2; // 16-bit PCM
  const durationSeconds = totalSamples / 16000; // 16 kHz sample rate

  console.log(`[Voice ${sessionId}] Audio format verification:`);
  console.log(`  - Total chunks: ${audioChunks.length}`);
  console.log(`  - Total bytes: ${totalBytes}`);
  console.log(`  - Total samples: ${totalSamples}`);
  console.log(`  - Duration: ${durationSeconds.toFixed(2)}s`);
  console.log(`  - Expected format: 16-bit PCM, 16kHz mono`);

  const combinedBuffer = Buffer.concat(audioChunks);
  const samples = new Int16Array(combinedBuffer.buffer, combinedBuffer.byteOffset, combinedBuffer.byteLength / 2);

  let nonZeroSamples = 0;
  let maxAmplitude = 0;

  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > 100) nonZeroSamples++;
    if (abs > maxAmplitude) maxAmplitude = abs;
  }

  const audioPresent = samples.length > 0 && nonZeroSamples / samples.length > 0.01;

  console.log(`  - Non-zero samples: ${nonZeroSamples} (${((nonZeroSamples / samples.length) * 100 || 0).toFixed(2)}%)`);
  console.log(`  - Max amplitude: ${maxAmplitude} / 32768`);
  console.log(`  - Audio detected: ${audioPresent ? "YES" : "NO - MIGHT BE SILENCE!"}`);

  return audioPresent;
}

// Replace transcribeAudio function with streaming version
const transcribeAudioStreaming = async (
  audioChunks: Buffer[],
  onTranscript: (text: string, isFinal: boolean) => void
) => {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error("Missing ASSEMBLYAI_API_KEY");

  // Use AssemblyAI v3 streaming endpoint
  const url = `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&format_turns=true`;

  return new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: {
        Authorization: apiKey,
      },
    });

    let fullTranscript = "";
    let finalTranscript = "";
    let opened = false;
    let sessionId = "";

    const timeout = setTimeout(() => {
      console.log("[AssemblyAI] Timeout - closing connection");
      ws.close();
      resolve(fullTranscript);
    }, 30000);

    ws.on("open", () => {
      opened = true;
      console.log("[AssemblyAI] WebSocket v3 opened");

      // Combine all chunks
      const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const combinedBuffer = Buffer.concat(audioChunks, totalLength);
      console.log(`[AssemblyAI] Sending ${combinedBuffer.length} bytes of audio`);

      // Send audio in chunks (v3 API expects raw PCM)
      const chunkSize = 8192;
      let offset = 0;

      const sendChunk = () => {
        if (offset >= combinedBuffer.length) {
          console.log("[AssemblyAI] All audio sent, sending termination");
          // Wait for final transcription before terminating
          setTimeout(() => {
            ws.send(JSON.stringify({ type: "Terminate" }));
          }, 1000);
          return;
        }

        const end = Math.min(offset + chunkSize, combinedBuffer.length);
        const chunk = combinedBuffer.slice(offset, end);

        // v3 API expects raw binary data
        ws.send(chunk);
        offset = end;

        // Small delay between chunks
        setTimeout(sendChunk, 50);
      };

      sendChunk();
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        console.log("[AssemblyAI] Message type:", msg.type);

        if (msg.type === "Begin") {
          sessionId = msg.id;
          console.log("[AssemblyAI] Session began:", sessionId);
          console.log("[AssemblyAI] Expires at:", new Date(msg.expires_at * 1000).toISOString());
        }

        if (msg.type === "Turn") {
          const text = msg.transcript || "";
          const isFormatted = msg.turn_is_formatted;

          console.log(`[AssemblyAI] Turn ${isFormatted ? "(formatted)" : "(partial)"}:`, text);

          if (text) {
            fullTranscript = text;

            if (isFormatted) {
              finalTranscript = text;
              onTranscript(text, true);
            } else {
              onTranscript(text, false);
            }
          }
        }

        if (msg.type === "Termination") {
          console.log("[AssemblyAI] Session terminated");
          console.log(`[AssemblyAI] Audio duration: ${msg.audio_duration_seconds}s`);
          console.log(`[AssemblyAI] Session duration: ${msg.session_duration_seconds}s`);
          clearTimeout(timeout);
          ws.close();
        }

        if (msg.type === "Error") {
          console.error("[AssemblyAI] Error:", msg.error);
          clearTimeout(timeout);
          reject(new Error(msg.error));
        }
      } catch (err) {
        console.error("[AssemblyAI] Parse error:", err);
      }
    });

    ws.on("close", (code, reason) => {
      console.log(`[AssemblyAI] WebSocket closed: ${code} - ${reason}`);
      console.log(`[AssemblyAI] Final transcript: "${finalTranscript || fullTranscript || "(empty)"}"`);
      clearTimeout(timeout);
      resolve(finalTranscript || fullTranscript);
    });

    ws.on("error", (err) => {
      console.error("[AssemblyAI] WebSocket error:", err);
      clearTimeout(timeout);
      if (!opened) {
        reject(err);
      } else {
        resolve(fullTranscript);
      }
    });
  });
};

// Stream TTS from local Piper HTTP endpoint
const streamTTSLocal = async ({
  text,
  voice = "en_US-lessac-medium",
  onChunk,
  signal,
}: {
  text: string;
  voice?: string;
  onChunk: (chunk: Buffer, isLast: boolean) => void;
  signal?: AbortSignal;
}) => {
  const controller = new AbortController();

  const abortHandler = () => controller.abort();
  signal?.addEventListener("abort", abortHandler);

  try {
    const response = await fetch("http://localhost:3000/api/tts-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn("[TTS] Request failed with status:", response.status);
      onChunk(Buffer.alloc(0), true);
      return;
    }

    // Check if this is a fallback response (no Piper available)
    const isFallback = response.headers.get("X-TTS-Fallback") === "true";
    
    if (isFallback || !response.body) {
      console.log("[TTS] Using fallback mode (no audio generation)");
      onChunk(Buffer.alloc(0), true);
      return;
    }

    const reader = response.body.getReader();
    let hasData = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        onChunk(Buffer.alloc(0), true);
        break;
      }

      if (signal?.aborted) {
        reader.cancel();
        break;
      }

      if (value && value.length > 0) {
        hasData = true;
        onChunk(Buffer.from(value), false);
      }
    }

    if (!hasData) {
      console.log("[TTS] No audio data received, using fallback");
    }
  } catch (err: any) {
    if (err?.name !== "AbortError") {
      console.error("[TTS] Error:", err);
    }
    // Always send completion signal even on error
    onChunk(Buffer.alloc(0), true);
  } finally {
    signal?.removeEventListener("abort", abortHandler);
  }
};

const SEARCHING_FILLERS = [
  "Let me check that for you",
  "Looking that up now",
  "Searching our knowledge base",
  "Give me a moment",
  "Let me find that information",
];

const getSearchingFiller = () => {
  return SEARCHING_FILLERS[Math.floor(Math.random() * SEARCHING_FILLERS.length)];
};

const handleVoiceFlow = async (
  socket: ClientSocket,
  { sessionId, voice = "en_US-lessac-medium", speed: _speed = 1 }: Pick<SocketDataEvent, "sessionId" | "voice" | "speed">
) => {
  // Prevent duplicate processing for the same session
  if (processingLocks.get(sessionId)) {
    console.log(`[Voice ${sessionId}] Already processing, ignoring duplicate request`);
    return;
  }

  processingLocks.set(sessionId, true);

  const session = voiceSessionStore.get(sessionId);

  if (!session?.chatId) {
    processingLocks.delete(sessionId);
    socket.emit("voice:error", { message: "Missing chat for voice session", sessionId });
    return;
  }

  const chatId = session.chatId!;

  try {
    setSessionState(sessionId, "processing");
    socket.emit("voice:state", { state: "processing", sessionId });

    console.log(`[Voice ${sessionId}] Starting transcription, chunks: ${session.audioChunks.length}`);
    
    const hasAudio = verifyAudioFormat(session.audioChunks, sessionId);
    if (!hasAudio) {
      console.warn(`[Voice ${sessionId}] Warning: Audio appears to be silence or invalid`);
    }

    let transcriptBuffer = "";

    const finalTranscript = await transcribeAudioStreaming(session.audioChunks, (text, isFinal) => {
      if (isFinal) {
        transcriptBuffer = text;
        socket.emit("voice:transcription:final", { text, sessionId });
      } else {
        socket.emit("voice:transcription:interim", { text, sessionId });
      }
    });

    const trimmedTranscript = (transcriptBuffer || finalTranscript).trim();
    session.lastTranscription = trimmedTranscript;

    console.log(`[Voice ${sessionId}] Transcription result:`, trimmedTranscript);

    if (!trimmedTranscript) {
      socket.emit("voice:response:text", {
        text: TRANSCRIPTION_FALLBACK_RESPONSE,
        sessionId,
        sourceInfo: [],
        fallback: true,
      });
      
      socket.emit("voice:response:audio", {
        audio: null,
        done: true,
        sessionId,
        mimeType: "audio/pcm",
        useBrowserTTS: true,
        ttsText: TRANSCRIPTION_FALLBACK_RESPONSE,
      });

      clearSessionAudio(sessionId);
      
      // Wait for browser TTS (estimate 150ms/word)
      const wordCount = TRANSCRIPTION_FALLBACK_RESPONSE.split(/\s+/).length;
      const waitTime = Math.max(3000, wordCount * 150);
      
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
      setSessionState(sessionId, "listening");
      socket.emit("voice:state", { state: "listening", sessionId });
      
      processingLocks.delete(sessionId);
      return;
    }

    await prisma.message.create({
      data: { content: trimmedTranscript, role: "user", chatId },
    });

    // Send searching filler
    setSessionState(sessionId, "thinking");
    socket.emit("voice:state", { state: "thinking", sessionId });
    
    const searchingMessage = getSearchingFiller();
    console.log(`[Voice ${sessionId}] Sending search filler: "${searchingMessage}"`);
    
    socket.emit("voice:filler:text", { text: searchingMessage, sessionId });

    // Try Piper TTS first, fall back to browser TTS
    try {
      let piperWorked = false;
      
      await streamTTSLocal({
        text: searchingMessage,
        voice,
        onChunk: (chunk, isLast) => {
          if (chunk.length > 0) {
            piperWorked = true;
            socket.emit("voice:filler:audio", {
              audio: chunk.toString("base64"),
              done: isLast,
              sessionId,
              mimeType: "audio/pcm",
            });
          } else if (isLast) {
            if (!piperWorked) {
              // Piper failed, use browser TTS
              socket.emit("voice:filler:audio", {
                audio: null,
                done: true,
                sessionId,
                mimeType: "audio/pcm",
                useBrowserTTS: true,
                ttsText: searchingMessage,
              });
            } else {
              // Piper produced audio earlier; just signal completion
              socket.emit("voice:filler:audio", {
                audio: null,
                done: true,
                sessionId,
                mimeType: "audio/pcm",
              });
            }
          }
        },
      });
    } catch (err) {
      console.error(`[Voice ${sessionId}] Filler TTS error, falling back:`, err);
      socket.emit("voice:filler:audio", {
        audio: null,
        done: true,
        sessionId,
        mimeType: "audio/pcm",
        useBrowserTTS: true,
        ttsText: searchingMessage,
      });
    }

    // Wait for filler to play
    const fillerWordCount = searchingMessage.split(/\s+/).length;
    const fillerWaitTime = Math.max(1500, fillerWordCount * 150);
    await new Promise(resolve => setTimeout(resolve, fillerWaitTime));

    // Query RAG
    const { response, sourceInfo } = await queryChatAndAnswer({ query: trimmedTranscript, chatId });

    const responseText = response || CHAT_FALLBACK_RESPONSE;

    console.log(`[Voice ${sessionId}] RAG response:`, responseText);

    socket.emit("voice:response:text", {
      text: responseText,
      sessionId,
      sourceInfo: sourceInfo || [],
      fallback: !response,
    });

    await prisma.message.create({
      data: { content: responseText, role: "assistant", chatId },
    });

    // Send for TTS
    setSessionState(sessionId, "speaking");
    socket.emit("voice:state", { state: "speaking", sessionId });

    const abortController = new AbortController();
    session.abortPlayback = abortController;

    try {
      let piperWorked = false;
      
      await streamTTSLocal({
        text: responseText,
        voice,
        signal: abortController.signal,
        onChunk: (chunk, isLast) => {
          if (abortController.signal.aborted) return;
          
          if (chunk.length > 0) {
            piperWorked = true;
            socket.emit("voice:response:audio", {
              audio: chunk.toString("base64"),
              done: isLast,
              sessionId,
              mimeType: "audio/pcm",
            });
          } else if (isLast) {
            if (!piperWorked) {
              // Piper failed, use browser TTS
              socket.emit("voice:response:audio", {
                audio: null,
                done: true,
                sessionId,
                mimeType: "audio/pcm",
                useBrowserTTS: true,
                ttsText: responseText,
              });
            } else {
              socket.emit("voice:response:audio", {
                audio: null,
                done: true,
                sessionId,
                mimeType: "audio/pcm",
              });
            }
          }
        },
      });
    } catch (err) {
      console.error(`[Voice ${sessionId}] Response TTS error, falling back:`, err);
      socket.emit("voice:response:audio", {
        audio: null,
        done: true,
        sessionId,
        mimeType: "audio/pcm",
        useBrowserTTS: true,
        ttsText: responseText,
      });
    }

    console.log(`[Voice ${sessionId}] Sent response for TTS playback`);

    // Wait for TTS (estimate 150ms/word + 1 second buffer)
    const wordCount = responseText.split(/\s+/).length;
    const estimatedDuration = Math.max(4000, wordCount * 150 + 1000);
    
    console.log(`[Voice ${sessionId}] Waiting ${estimatedDuration}ms for TTS (${wordCount} words)`);
    await new Promise(resolve => setTimeout(resolve, estimatedDuration));

    // Return to listening
    clearSessionAudio(sessionId);
    setSessionState(sessionId, "listening");
    socket.emit("voice:state", { state: "listening", sessionId });

    console.log(`[Voice ${sessionId}] Ready for next input`);
  } catch (err: any) {
    console.error(`[Voice ${sessionId}] Error:`, err);
    setSessionState(sessionId, "error");
    socket.emit("voice:error", {
      message: err.message || "Failed to process voice request",
      sessionId,
    });

    setTimeout(() => {
      clearSessionAudio(sessionId);
      setSessionState(sessionId, "listening");
      socket.emit("voice:state", { state: "listening", sessionId });
      processingLocks.delete(sessionId);
    }, 2000);
    return;
  }

  processingLocks.delete(sessionId);
};

export default function handler(req: NextApiRequest, res: ResponseWithSocket) {
  console.log("voice socket API hit", req.method, req.url);
  try {
    if (res.socket.server.io) {
      console.log("Socket.IO server already running");
      res.status(200).end();
      return;
    }

    if (!res.socket.server) {
      console.error("No server instance on res.socket");
      res.status(500).end();
      return;
    }

    console.log("Initializing new Socket.IO server instance");
    const io = new IOServer(res.socket.server, {
      path: "/api/socket",
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
    });

    res.socket.server.io = io;

    io.on("connection", (socket) => {
      const sessionIdsForSocket = new Set<string>();

      socket.on("voice:session:start", ({ chatId, userId }: SocketDataEvent) => {
        console.log("[Socket] Received session start request:", { chatId, userId });

        if (!chatId) {
          console.error("[Socket] No chatId provided");
          socket.emit("voice:error", {
            message: "Select a conversation before starting voice.",
            sessionId: null,
          });
          return;
        }

        const sessionId = randomUUID();
        console.log("[Socket] Creating new session:", sessionId);

        voiceSessionStore.set(sessionId, {
          id: sessionId,
          chatId,
          userId,
          status: "listening",
          audioChunks: [],
        });

        sessionIdsForSocket.add(sessionId);

        console.log("[Socket] Emitting voice:session:started with sessionId:", sessionId);
        socket.emit("voice:session:started", { sessionId });
        
        // Wait a moment before sending listening state to ensure session is established
        setTimeout(() => {
          console.log("[Socket] Emitting listening state for session:", sessionId);
          socket.emit("voice:state", { sessionId, state: "listening" });
        }, 100);

        console.log("[Socket] Session initialized successfully:", {
          sessionId,
          chatId,
          state: "listening",
        });
      });

      socket.on("voice:audio:chunk", ({ sessionId, audio }: SocketDataEvent) => {
        if (!sessionId || !audio) return;
        enqueueAudioChunk(sessionId, Buffer.from(audio, "base64"));
      });

      socket.on("voice:audio:complete", async (payload: SocketDataEvent) => {
        if (!payload?.sessionId) return;
        await handleVoiceFlow(socket, payload);
      });

      socket.on("voice:interrupted", ({ sessionId }: SocketDataEvent) => {
        const session = voiceSessionStore.get(sessionId);
        if (!session) return;

        console.log(`[Voice ${sessionId}] Barge-in detected, aborting TTS`);

        session.abortPlayback?.abort();
        session.bargeInDetected = true;

        clearSessionAudio(sessionId);

        setSessionState(sessionId, "listening");
        socket.emit("voice:state", { sessionId, state: "listening" });

        console.log(`[Voice ${sessionId}] Ready for new user input after barge-in`);
      });

      socket.on("voice:session:end", ({ sessionId }: SocketDataEvent) => {
        const session = voiceSessionStore.get(sessionId);
        session?.abortPlayback?.abort();
        voiceSessionStore.delete(sessionId);
        socket.emit("voice:session:ended", { sessionId });
      });

      socket.on("disconnect", () => {
        sessionIdsForSocket.forEach((sessionId) => {
          const session = voiceSessionStore.get(sessionId);
          session?.abortPlayback?.abort();
          voiceSessionStore.delete(sessionId);
        });
        sessionIdsForSocket.clear();
      });
    });

    res.status(200).end("Socket server ready");
  } catch (err) {
    console.error("Socket server init error:", err);
    res.status(500).end();
  }
}
