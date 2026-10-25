"use client";
import { useEffect, useRef } from "react";
import { X, Mic, MicOff, Loader2, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVoiceSession, VoiceSessionSourceInfo } from "@/hooks/useVoiceSession";

interface VoiceSessionModalProps {
  open: boolean;
  chatId: string | null;
  userId?: string;
  onClose: () => void;
  onVoiceUserMessage: (text: string) => void;
  onVoiceAssistantMessage: (text: string, sourceInfo?: VoiceSessionSourceInfo) => void;
}

const VoiceWaveform = ({ isActive, volume }: { isActive: boolean; volume: number }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    const bars = 40;
    const barWidth = width / bars;
    const barHeights = new Array(bars).fill(0);

    const animate = () => {
      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < bars; i++) {
        if (isActive) {
          const targetHeight = Math.sin(Date.now() / 200 + i / 3) * 30 + volume * 100;
          barHeights[i] = barHeights[i] * 0.8 + targetHeight * 0.2;
        } else {
          barHeights[i] *= 0.9;
        }

        const barHeight = Math.max(2, barHeights[i]);
        const x = i * barWidth;
        const y = (height - barHeight) / 2;

        const gradient = ctx.createLinearGradient(x, y, x, y + barHeight);
        gradient.addColorStop(0, "rgba(59, 130, 246, 0.8)");
        gradient.addColorStop(1, "rgba(147, 51, 234, 0.8)");

        ctx.fillStyle = gradient;
        ctx.fillRect(x + 1, y, barWidth - 2, barHeight);
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isActive, volume]);

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={80}
      className="w-full max-w-md"
    />
  );
};

const ThinkingDots = () => (
  <div className="flex items-center gap-1">
    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
  </div>
);

export function VoiceSessionModal({
  open,
  chatId,
  userId,
  onClose,
  onVoiceUserMessage,
  onVoiceAssistantMessage,
}: VoiceSessionModalProps) {
  const {
    status,
    interimTranscript,
    finalTranscript,
    responseText,
    error,
    volume,
    loading,
    stop,
    interrupt,
    startSession,
    disableContinuousMode,
  } = useVoiceSession({
    chatId,
    userId,
    enabled: open,
    onUserMessage: onVoiceUserMessage,
    onAssistantMessage: onVoiceAssistantMessage,
  });

  useEffect(() => {
    if (!open) {
      stop();
    }
  }, [open, stop]);

  if (!open) return null;

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white dark:bg-gray-900 rounded-lg p-8 text-center shadow-xl">
          <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-600 dark:text-gray-400">Loading voice models...</p>
        </div>
      </div>
    );
  }

  const displayTranscript = interimTranscript || finalTranscript;
  const isSpeaking = status === "speaking";
  const isActive = status === "listening" || status === "capturing";
  const isProcessing = status === "processing" || status === "thinking";

  const getStatusMessage = () => {
    switch (status) {
      case "idle":
        return "Paused due to inactivity - speak to continue";
      case "listening":
        return "Listening... speak naturally";
      case "capturing":
        return "Recording your voice...";
      case "processing":
        return "Processing your request...";
      case "thinking":
        return "Searching our knowledge base...";
      case "speaking":
        return "Speaking... (speak to interrupt)";
      case "connecting":
        return "Connecting...";
      case "interrupted":
        return "Interrupted";
      case "error":
        return error || "Error occurred";
      default:
        return "Ready";
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case "listening":
        return "bg-green-500";
      case "capturing":
        return "bg-red-500";
      case "processing":
      case "thinking":
        return "bg-yellow-500";
      case "speaking":
        return "bg-blue-500";
      default:
        return "bg-gray-500";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="relative w-[90vw] max-w-3xl rounded-3xl bg-gradient-to-br from-slate-900 to-slate-800 shadow-2xl overflow-hidden border border-slate-700">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50 bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${getStatusColor()} animate-pulse`} />
            <h2 className="text-lg font-semibold text-white">Voice Assistant</h2>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => {
              stop();
              onClose();
            }}
            className="text-slate-300 hover:bg-slate-700/50"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Main Content */}
        <div className="p-8 space-y-6">
          {/* Show start button if idle */}
          {status === "idle" && (
            <div className="flex flex-col items-center gap-4">
              <Button type="button" size="lg" onClick={startSession} className="px-8 py-6 text-lg">
                Start Voice Session
              </Button>
              <p className="text-sm text-slate-400">Click to initialize voice chat</p>
            </div>
          )}

          {/* Waveform and Status - only show when session is active */}
          {status !== "idle" && (
            <div className="flex flex-col items-center gap-4">
              <VoiceWaveform isActive={isActive} volume={volume} />
              
              <div className="flex items-center gap-2 px-4 py-2 bg-slate-800/50 rounded-full border border-slate-700/50">
                {isProcessing ? (
                  <>
                    <ThinkingDots />
                    <span className="text-sm text-slate-300 ml-2">{getStatusMessage()}</span>
                  </>
                ) : status === "speaking" ? (
                  <>
                    <Volume2 className="w-4 h-4 text-blue-400 animate-pulse" />
                    <span className="text-sm text-slate-300">{getStatusMessage()}</span>
                  </>
                ) : status === "capturing" ? (
                  <>
                    <MicOff className="w-4 h-4 text-red-400" />
                    <span className="text-sm text-slate-300">{getStatusMessage()}</span>
                  </>
                ) : (
                  <>
                    <Mic className={`w-4 h-4 ${isActive ? "text-green-400" : "text-slate-400"}`} />
                    <span className="text-sm text-slate-300">{getStatusMessage()}</span>
                  </>
                )}
              </div>

              {/* VAD Active Indicator */}
              <div className="flex items-center gap-2 px-3 py-1 bg-blue-100 dark:bg-blue-900/20 rounded-full">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
                  Voice Activity Detection Active
                </span>
              </div>

              {/* Volume indicator when capturing */}
              {status === "capturing" && (
                <div className="w-full max-w-xs h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-100"
                    style={{ width: `${Math.min(volume * 300, 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Transcription */}
          {displayTranscript && (
            <div className="rounded-xl bg-slate-800/70 p-4 border border-slate-700/50 backdrop-blur">
              <p className="text-xs font-medium text-slate-400 mb-2">You said:</p>
              <p className="text-base text-white leading-relaxed">
                {displayTranscript}
                {interimTranscript && (
                  <span className="inline-block w-0.5 h-5 bg-blue-500 animate-pulse ml-1 align-middle" />
                )}
              </p>
            </div>
          )}

          {responseText && (
            <div className="rounded-xl bg-gradient-to-br from-blue-900/30 to-purple-900/30 p-4 border border-blue-500/30 backdrop-blur">
              <p className="text-xs font-medium text-blue-300 mb-2">Assistant:</p>
              <p className="text-base text-white leading-relaxed whitespace-pre-wrap">
                {responseText}
                {status === "speaking" && (
                  <span className="inline-block w-0.5 h-5 bg-blue-400 animate-pulse ml-1 align-middle" />
                )}
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-900/20 p-4 text-red-400 border border-red-500/30">
              {error}
            </div>
          )}

          {status === "listening" && !displayTranscript && (
            <div className="text-center space-y-2">
              <p className="text-sm text-slate-400">💡 Pro tip: Just start speaking naturally</p>
              <p className="text-xs text-slate-500">I'll automatically detect when you're done</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-700/50 bg-slate-800/50">
          {isSpeaking ? (
            <Button
              type="button"
              variant="outline"
              onClick={interrupt}
              className="w-full bg-red-600 hover:bg-red-700 text-white border-0"
            >
              Interrupt & Speak
            </Button>
          ) : (
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                disableContinuousMode();
                stop();
                onClose();
              }}
              className="w-full"
            >
              End Session
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
