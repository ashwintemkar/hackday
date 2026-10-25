import { useState, useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { VADManager } from "@/lib/vad/vadManager";
import { DEFAULT_VAD_CONFIG, BARGE_IN_VAD_CONFIG } from "@/lib/vad/config";

export type VoiceSessionSourceInfo = any[];

export type VoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "capturing"
  | "processing"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "error";

const PCM_SAMPLE_RATE = 44100;
const IDLE_TIMEOUT_MS = 30000; // 30 seconds
const AUDIO_GAIN_MULTIPLIER = 3.0; // Boost microphone input

const base64ToArrayBuffer = (base64: string) => {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};

const pcmToAudioBuffer = (ctx: AudioContext, audioData: ArrayBuffer) => {
  if (!audioData.byteLength) return null;
  const pcm = new Int16Array(audioData);
  const floatData = new Float32Array(pcm.length);
  const norm = 1 / 0x8000;
  for (let i = 0; i < pcm.length; i++) {
    floatData[i] = pcm[i] * norm;
  }
  const buffer = ctx.createBuffer(1, floatData.length, ctx.sampleRate || PCM_SAMPLE_RATE);
  buffer.copyToChannel(floatData, 0);
  return buffer;
};

const speakTextWithBrowserTTS = (
  text: string,
  onEnd: () => void,
  signal?: AbortSignal
): (() => void) => {
  if (!("speechSynthesis" in window)) {
    console.error("[Voice] Browser TTS not supported");
    onEnd();
    return () => {};
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.1;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;
  
  utterance.onend = () => {
    console.log("[Voice] Browser TTS finished");
    onEnd();
  };
  
  utterance.onerror = (event) => {
    // Suppress "interrupted" errors as they're expected during barge-in
    if ((event as SpeechSynthesisErrorEvent).error !== "interrupted") {
      console.error("[Voice] Browser TTS error:", (event as SpeechSynthesisErrorEvent).error || "Unknown error");
    }
    onEnd();
  };

  // Handle abort signal
  const abortHandler = () => {
    window.speechSynthesis.cancel();
    onEnd();
  };
  
  if (signal) {
    signal.addEventListener("abort", abortHandler);
  }

  window.speechSynthesis.cancel(); // Cancel any ongoing speech
  window.speechSynthesis.speak(utterance);

  // Return cleanup function
  return () => {
    if (signal) {
      signal.removeEventListener("abort", abortHandler);
    }
    window.speechSynthesis.cancel();
  };
};

interface UseVoiceSessionProps {
  chatId: string | null;
  userId?: string;
  enabled: boolean;
  onUserMessage?: (text: string) => void;
  onAssistantMessage?: (text: string, sourceInfo?: VoiceSessionSourceInfo) => void;
}

export type UseVoiceSessionReturn = {
  status: VoiceStatus;
  interimTranscript: string;
  finalTranscript: string;
  responseText: string;
  error: string | null;
  volume: number;
  aiSpeaking: boolean;
  loading: boolean;
  stopRecording: () => void;
  interrupt: () => void;
  stop: () => void;
  startSession: () => void;
  disableContinuousMode: () => void;
};

export function useVoiceSession({
  chatId,
  userId,
  enabled,
  onUserMessage,
  onAssistantMessage,
}: UseVoiceSessionProps): UseVoiceSessionReturn {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [responseText, setResponseText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [loading, setLoading] = useState(true);

  const socketRef = useRef<Socket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const continuousModeRef = useRef(false);
  const vadManagerRef = useRef<VADManager | null>(null);
  const isBargeInModeRef = useRef(false);
  const pendingListeningRef = useRef(false);
  const responseTextRef = useRef("");
  const sessionRef = useRef<{
    abortPlayback?: AbortController;
  }>({});
  const idleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const resetIdleTimeout = useCallback(() => {
    lastActivityRef.current = Date.now();
    
    if (idleTimeoutRef.current) {
      clearTimeout(idleTimeoutRef.current);
    }

    idleTimeoutRef.current = setTimeout(() => {
      console.log("[Voice] Idle timeout reached, pausing VAD");
      if (vadManagerRef.current && status === "listening") {
        vadManagerRef.current.pause().catch(console.error);
        setStatus("idle");
        socketRef.current?.emit("voice:idle", { sessionId: sessionIdRef.current });
      }
    }, IDLE_TIMEOUT_MS);
  }, [status]);

  const clearIdleTimeout = useCallback(() => {
    if (idleTimeoutRef.current) {
      clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = null;
    }
  }, []);

  const resetPlayback = useCallback(() => {
    sessionRef.current.abortPlayback?.abort();
    sessionRef.current.abortPlayback = undefined;
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    if (playbackSourceRef.current) {
      try {
        playbackSourceRef.current.stop();
      } catch {
        // ignore if already stopped
      }
      playbackSourceRef.current.disconnect();
      playbackSourceRef.current = null;
    }
    if (playbackContextRef.current) {
      playbackContextRef.current.close().catch(() => undefined);
      playbackContextRef.current = null;
    }
  }, []);

  // Initialize socket connection
  useEffect(() => {
    if (!enabled) return;

    const initSocket = async () => {
      try {
        const response = await fetch("/api/socket");
        if (!response.ok) throw new Error("Failed to initialize socket");

        const socket = io({
          path: "/api/socket",
          transports: ["websocket", "polling"],
        });

        socket.on("connect", () => {
          console.log("[Voice] Socket connected");
          console.log("[Voice] Socket ID:", socket.id);
          console.log("[Voice] Chat ID:", chatId);
          setLoading(false);
        });

        socket.on("disconnect", () => {
          console.log("[Voice] Socket disconnected");
          setStatus("idle");
        });

        socket.on("voice:session:started", ({ sessionId }) => {
          console.log("[Voice] Session started:", sessionId);
          sessionIdRef.current = sessionId;
          setStatus("listening");
          
          // Start recording AFTER session ID is set
          setTimeout(() => {
            void startRecording();
          }, 100);
        });

        socket.on("voice:state", ({ state }) => {
          console.log("[Voice] State changed:", state);
          setStatus(state);

          if (state === "speaking") {
            clearIdleTimeout(); // Clear idle timeout during TTS
            setAiSpeaking(true);
            pendingListeningRef.current = false;
            void enableBargeInDetection();
          }

          if (state === "listening") {
            setAiSpeaking(false);
            resetIdleTimeout(); // Reset idle timeout when listening

            setTimeout(() => {
              setInterimTranscript("");
              setResponseText("");
              responseTextRef.current = "";
            }, 500);

            if (!continuousModeRef.current) {
              return;
            }

            const playbackActive =
              isPlayingRef.current || audioQueueRef.current.length > 0;
            if (playbackActive) {
              pendingListeningRef.current = true;
              void pauseVadForPlayback();
              return;
            }

            void disableBargeInDetection();
          }

          if (state === "processing" || state === "thinking") {
            clearIdleTimeout(); // Clear during processing
          }
        });

        socket.on("voice:transcription:interim", ({ text }) => {
          console.log("[Voice] Interim transcript:", text);
          setInterimTranscript(text);
        });

        socket.on("voice:transcription:final", ({ text }) => {
          console.log("[Voice] Final transcript:", text);
          setFinalTranscript(text);
          setInterimTranscript("");
          onUserMessage?.(text);
        });

        socket.on("voice:response:text", ({ text, sourceInfo }) => {
          console.log("[Voice] Response text:", text);
          setResponseText(text);
          responseTextRef.current = text;
          sessionRef.current.abortPlayback?.abort();
          sessionRef.current.abortPlayback = new AbortController();
          onAssistantMessage?.(text, sourceInfo);
        });

        socket.on("voice:response:audio", ({ audio, done, mimeType, useBrowserTTS, ttsText }) => {
          if (useBrowserTTS && ttsText && done) {
            // Use browser TTS for this response
            console.log("[Voice] Using browser TTS for response");
            setAiSpeaking(true);

            const abortController = sessionRef.current.abortPlayback ?? new AbortController();
            sessionRef.current.abortPlayback = abortController;

            let cleanup = () => {};
            const handleEnd = () => {
              cleanup();
              sessionRef.current.abortPlayback = undefined;
              setAiSpeaking(false);
              
              // Don't resume immediately - let backend handle timing
              console.log("[Voice] Browser TTS completed");
            };

            cleanup = speakTextWithBrowserTTS(
              ttsText,
              handleEnd,
              abortController.signal
            );

            const originalAbort = abortController.abort.bind(abortController);
            abortController.abort = () => {
              cleanup();
              sessionRef.current.abortPlayback = undefined;
              setAiSpeaking(false);
              originalAbort();
            };

            return;
          }

          // Original audio chunk handling (keep existing code)
          if (audio) {
            const audioBuffer = base64ToArrayBuffer(audio);
            if (audioBuffer.byteLength > 0) {
              audioQueueRef.current.push(audioBuffer);
              if (!isPlayingRef.current) {
                playAudioQueue();
              }
            }
          }
          
          if (done) {
            console.log("[Voice] Audio streaming complete");
            
            if (audioQueueRef.current.length === 0 && responseTextRef.current && !useBrowserTTS) {
              console.log("[Voice] No Piper audio, using browser TTS fallback");
              setAiSpeaking(true);

              const abortController =
                sessionRef.current.abortPlayback ?? new AbortController();
              sessionRef.current.abortPlayback = abortController;

              let cleanup = () => {};
              const handleEnd = () => {
                cleanup();
                sessionRef.current.abortPlayback = undefined;
                setAiSpeaking(false);
                resumeListeningAfterPlayback();
              };

              cleanup = speakTextWithBrowserTTS(
                responseTextRef.current,
                handleEnd,
                abortController.signal
              );
              
              const originalAbort = abortController.abort.bind(abortController);
              abortController.abort = () => {
                cleanup();
                sessionRef.current.abortPlayback = undefined;
                setAiSpeaking(false);
                originalAbort();
              };
            }
          }
        });

        socket.on("voice:filler:text", ({ text }) => {
          console.log("[Voice] Filler:", text);
          setResponseText(text);
        });

        socket.on("voice:filler:audio", ({ audio, done, useBrowserTTS, ttsText }) => {
          if (useBrowserTTS && ttsText && done) {
            console.log("[Voice] Using browser TTS for filler");
            
            const utterance = new SpeechSynthesisUtterance(ttsText);
            utterance.rate = 1.1;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;
            
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(utterance);
            return;
          }

          // Original filler handling
          if (audio) {
            const audioBuffer = base64ToArrayBuffer(audio);
            if (audioBuffer.byteLength > 0) {
              audioQueueRef.current.push(audioBuffer);
              if (!isPlayingRef.current) {
                playAudioQueue();
              }
            }
          }
          // Don't transition state on filler completion, wait for main response
        });

        socket.on("voice:error", ({ message }) => {
          console.error("[Voice] Error:", message);
          setError(message);
          setStatus("error");
        });

        socketRef.current = socket;
      } catch (err) {
        console.error("[Voice] Socket init error:", err);
        setError("Failed to connect to voice service");
        setLoading(false);
      }
    };

    initSocket();

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      resetPlayback();
    };
  }, [enabled, resetPlayback]);

  // Start voice session when enabled and chatId available
  useEffect(() => {
    if (!enabled || !chatId || !socketRef.current) {
      console.log("[Voice] Start session blocked:", { enabled, chatId, hasSocket: !!socketRef.current });
      return;
    }

    const startSessionWhenConnected = () => {
      if (!socketRef.current?.connected) {
        console.log("[Voice] Socket not connected yet, retrying...");
        setTimeout(startSessionWhenConnected, 100);
        return;
      }

      if (sessionIdRef.current) {
        console.log("[Voice] Session already exists:", sessionIdRef.current);
        return;
      }

      console.log("[Voice] Emitting voice:session:start for chat:", chatId);
      socketRef.current.emit("voice:session:start", { chatId, userId });
    };

    startSessionWhenConnected();
  }, [enabled, chatId, userId]);

  const startSession = useCallback(() => {
    if (!chatId || !socketRef.current?.connected) {
      console.error("[Voice] Cannot start session - missing chatId or socket not connected");
      setError("Not connected to voice service");
      return;
    }

    if (sessionIdRef.current) {
      console.log("[Voice] Session already active");
      return;
    }

    console.log("[Voice] Manually starting session for chat:", chatId);
    socketRef.current.emit("voice:session:start", { chatId, userId });
  }, [chatId, userId]);

  const startAudioCapture = useCallback(() => {
    if (!sessionIdRef.current) {
      console.error("[Voice] No session ID");
      return;
    }

    if (streamRef.current || audioContextRef.current) {
      return;
    }

    if (isPlayingRef.current || audioQueueRef.current.length > 0) {
      console.log("[Voice] Skipping capture while playback is active");
      return;
    }

    console.log("[Voice] Starting audio capture...");
    setStatus("capturing");

    navigator.mediaDevices
      .getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      .then((stream) => {
        streamRef.current = stream;
        audioContextRef.current = new AudioContext({ sampleRate: 16000 });

        const source = audioContextRef.current.createMediaStreamSource(stream);
        const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);

          // Apply gain to boost microphone input
          const boostedData = new Float32Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            boostedData[i] = Math.max(-1, Math.min(1, inputData[i] * AUDIO_GAIN_MULTIPLIER));
          }

          const sum = boostedData.reduce((acc, val) => acc + Math.abs(val), 0);
          setVolume(sum / boostedData.length);

          const pcmData = new Int16Array(boostedData.length);
          for (let i = 0; i < boostedData.length; i++) {
            const s = Math.max(-1, Math.min(1, boostedData[i]));
            pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }

          const base64 = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
          socketRef.current?.emit("voice:audio:chunk", {
            sessionId: sessionIdRef.current,
            audio: base64,
          });
        };

        source.connect(processor);
        processor.connect(audioContextRef.current.destination);
      })
      .catch((err) => {
        console.error("[Voice] Microphone error:", err);
        setError(`Microphone access failed: ${err.message}`);
        setStatus("error");
      });
  }, [setError, setStatus, setVolume]);

  const stopAudioCapture = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (sessionIdRef.current && socketRef.current) {
      socketRef.current.emit("voice:audio:complete", {
        sessionId: sessionIdRef.current,
      });
    }

    setVolume(0);
    setStatus("processing");
  }, [setStatus, setVolume]);

  const startDefaultVad = useCallback(async () => {
    if (!vadManagerRef.current) {
      vadManagerRef.current = new VADManager();
    }

    await vadManagerRef.current.pause();

    await vadManagerRef.current.initialize(
      DEFAULT_VAD_CONFIG,
      () => {
        resetIdleTimeout(); // Reset on speech start
        startAudioCapture();
      },
      stopAudioCapture,
      (error) => {
        console.error("[Voice] VAD error:", error);
        setError(`VAD error: ${error.message}`);
        setStatus("error");
      }
    );

    await vadManagerRef.current.start();
    isBargeInModeRef.current = false;
    resetIdleTimeout(); // Start idle timer
  }, [setError, setStatus, startAudioCapture, stopAudioCapture, resetIdleTimeout]);

  const pauseVadForPlayback = useCallback(async () => {
    if (!vadManagerRef.current) return;
    try {
      await vadManagerRef.current.pause();
    } catch (err) {
      console.error("[Voice] Failed to pause VAD:", err);
    }
  }, []);

  // Audio playback queue
  const playAudioQueue = async () => {
    if (isPlayingRef.current) return;

    isPlayingRef.current = true;
    let playbackContext = playbackContextRef.current;
    if (!playbackContext || playbackContext.state === "closed") {
      try {
        playbackContext = new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
      } catch {
        playbackContext = new AudioContext();
      }
      playbackContextRef.current = playbackContext;
    }

    const buildSource = (data?: ArrayBuffer | null) => {
      if (!data || playbackContext.state === "closed") return null;
      try {
        const audioBuffer = pcmToAudioBuffer(playbackContext!, data);
        if (!audioBuffer) return null;
        const source = playbackContext!.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(playbackContext!.destination);
        return source;
      } catch (err) {
        console.error("[Voice] Preload error:", err);
        return null;
      }
    };

    let nextSource: AudioBufferSourceNode | null = buildSource(audioQueueRef.current.shift());

    while (isPlayingRef.current) {
      const currentSource = nextSource;
      nextSource = null;

      // Preload next chunk
      nextSource = buildSource(audioQueueRef.current.shift());

      if (currentSource) {
        playbackSourceRef.current = currentSource;
        await new Promise<void>((resolve) => {
          currentSource.onended = () => {
            playbackSourceRef.current = null;
            resolve();
          };
          currentSource.start();
        });
      } else if (!nextSource && audioQueueRef.current.length === 0) {
        // Nothing to play, small wait to see if more arrives
        await new Promise((resolve) => setTimeout(resolve, 50));
        nextSource = buildSource(audioQueueRef.current.shift());
        if (!nextSource) break;
      }
    }

    playbackSourceRef.current = null;
    isPlayingRef.current = false;
    if (playbackContext.state !== "closed") {
      try {
        await playbackContext.close();
      } catch {
        // ignore close errors
      }
    }
    playbackContextRef.current = null;
    resumeListeningAfterPlayback();
  };

  // Start VAD-managed recording flow
  const startRecording = useCallback(async () => {
    if (!sessionIdRef.current) {
      console.error("[Voice] No session ID");
      return;
    }

    continuousModeRef.current = true;

    try {
      console.log("[Voice] Starting VAD-based recording...");

      await startDefaultVad();
      setStatus("listening");
      console.log("[Voice] VAD started, listening for speech...");
    } catch (err: any) {
      console.error("[Voice] VAD initialization error:", err);
      setError(`Failed to start voice detection: ${err.message}`);
      setStatus("error");
      continuousModeRef.current = false;
    }
  }, [setError, setStatus, startDefaultVad]);

  // Stop recording and send for processing
  const stopRecording = useCallback(() => {
    console.log("[Voice] Stopping recording...");
    stopAudioCapture();
  }, [stopAudioCapture]);

  // Interrupt AI speech
  const interrupt = useCallback(() => {
    if (!sessionIdRef.current || !socketRef.current) return;

    console.log("[Voice] Interrupting");
    resetPlayback();
    pendingListeningRef.current = false;
    
    socketRef.current.emit("voice:interrupted", {
      sessionId: sessionIdRef.current,
    });
    
    setStatus("listening");
    setAiSpeaking(false);
  }, [resetPlayback]);

  // Add barge-in detection when AI is speaking
  const enableBargeInDetection = useCallback(async () => {
    if (!vadManagerRef.current) return;

    console.log("[Voice] Enabling barge-in detection during AI speech");
    isBargeInModeRef.current = true;

    try {
      await vadManagerRef.current.pause();

      const strictBargeInConfig = {
        ...BARGE_IN_VAD_CONFIG,
        positiveSpeechThreshold: 0.85, // Even stricter
        minSpeechFrames: 8, // Require more frames
        redemptionFrames: 45, // Longer silence requirement
      };

      await vadManagerRef.current.initialize(
        strictBargeInConfig,
        () => {
          console.log("[Voice] BARGE-IN DETECTED!");
          interrupt();
        },
        () => {},
        (error) => {
          console.error("[Voice] Barge-in VAD error:", error);
        }
      );

      await vadManagerRef.current.start();
    } catch (err) {
      console.error("[Voice] Failed to enable barge-in detection:", err);
    }
  }, [interrupt]);

  const disableBargeInDetection = useCallback(async () => {
    if (!vadManagerRef.current) return;

    console.log("[Voice] Disabling barge-in detection");
    isBargeInModeRef.current = false;

    try {
      await startDefaultVad();
    } catch (err) {
      console.error("[Voice] Failed to disable barge-in detection:", err);
    }
  }, [startDefaultVad]);

  const resumeListeningAfterPlayback = useCallback(() => {
    if (!pendingListeningRef.current) return;
    if (!continuousModeRef.current) {
      pendingListeningRef.current = false;
      return;
    }

    const playbackActive =
      isPlayingRef.current || audioQueueRef.current.length > 0;
    if (playbackActive) return;

    pendingListeningRef.current = false;
    
    // Much longer delay - let TTS fully finish
    setTimeout(() => {
      if (aiSpeaking) {
        console.log("[Voice] TTS still active, delaying VAD resume");
        // Retry after another delay
        setTimeout(() => {
          console.log("[Voice] Resuming VAD after extended delay");
          void disableBargeInDetection();
          resetIdleTimeout();
        }, 2000);
      } else {
        console.log("[Voice] Resuming VAD after playback");
        void disableBargeInDetection();
        resetIdleTimeout();
      }
    }, 1000);
  }, [disableBargeInDetection, aiSpeaking, resetIdleTimeout]);

  // Disable continuous mode without ending session
  const disableContinuousMode = useCallback(() => {
    console.log("[Voice] Disabling continuous mode");
    continuousModeRef.current = false;
  }, []);

  // End session
  const stop = useCallback(() => {
    console.log("[Voice] Stopping session");
    continuousModeRef.current = false;
    pendingListeningRef.current = false;
    clearIdleTimeout(); // Clear idle timeout

    if (vadManagerRef.current) {
      vadManagerRef.current.destroy().catch(console.error);
      vadManagerRef.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (sessionIdRef.current && socketRef.current) {
      socketRef.current.emit("voice:session:end", {
        sessionId: sessionIdRef.current,
      });
    }

    resetPlayback();
    sessionIdRef.current = null;
    
    setStatus("idle");
    setInterimTranscript("");
    setFinalTranscript("");
    setResponseText("");
    setError(null);
    setAiSpeaking(false);
  }, [resetPlayback, clearIdleTimeout]);

  return {
    status,
    interimTranscript,
    finalTranscript,
    responseText,
    error,
    volume,
    aiSpeaking,
    loading,
    stopRecording,
    interrupt,
    stop,
    startSession,
    disableContinuousMode,
  };
}
