import { useState, FormEvent } from "react";
import { Send, Paperclip, Mic, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileListItem } from "@/components/FileListItem";

interface ChatInputProps {
  loading: boolean;
  onSendMessage: (content: string) => Promise<string | undefined>;
  selectedFiles: File[];
  processingFiles: boolean;
  currentFileIndex: number;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveFile: (index: number) => void;
  onClearFiles: () => void;
  onTriggerFileInput: () => void;
  onUploadFiles: () => Promise<boolean | undefined>;
  currentChat: string | null;
  onOpenVoice: () => void;
}

export function ChatInput({
  loading,
  onSendMessage,
  selectedFiles,
  processingFiles,
  currentFileIndex,
  fileInputRef,
  onFileSelect,
  onRemoveFile,
  onClearFiles,
  onTriggerFileInput,
  onUploadFiles,
  currentChat,
  onOpenVoice
}: ChatInputProps) {
  const [input, setInput] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !currentChat) return;
    
    const currentInput = input;
    setInput("");
    await onSendMessage(currentInput);
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 border-t">
      <div className="flex items-center space-x-4">
        <input
          type="file"
          ref={fileInputRef}
          onChange={onFileSelect}
          className="hidden"
          accept=".txt,.pdf,.md"
          multiple
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={onTriggerFileInput}
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={onOpenVoice}
          disabled={loading || !currentChat}
        >
          <Mic className="h-4 w-4" />
        </Button>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
          className="flex-1 p-2 border rounded-lg focus:outline-none focus:ring-2 bg-background"
          disabled={loading}
        />
        <Button
          type="submit"
          disabled={loading || !input.trim()}
        >
          <Send className="h-4 w-4 mr-2" />
          Send
        </Button>
      </div>

      {selectedFiles.length > 0 && (
        <FileUploadSection
          selectedFiles={selectedFiles}
          processingFiles={processingFiles}
          currentFileIndex={currentFileIndex}
          onRemoveFile={onRemoveFile}
          onClearFiles={onClearFiles}
          onUploadFiles={onUploadFiles}
        />
      )}
    </form>
  );
}

interface FileUploadSectionProps {
  selectedFiles: File[];
  processingFiles: boolean;
  currentFileIndex: number;
  onRemoveFile: (index: number) => void;
  onClearFiles: () => void;
  onUploadFiles: () => Promise<boolean | undefined>;
}

function FileUploadSection({
  selectedFiles,
  processingFiles,
  currentFileIndex,
  onRemoveFile,
  onClearFiles,
  onUploadFiles
}: FileUploadSectionProps) {
  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          Selected Files ({selectedFiles.length})
        </span>
        {!processingFiles && (
          <div className="flex space-x-2">
            <Button
              size="sm"
              onClick={onUploadFiles}
              disabled={processingFiles}
            >
              {processingFiles ? "Processing..." : "Upload All Files"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearFiles}
              disabled={processingFiles}
            >
              Clear All
            </Button>
          </div>
        )}
      </div>

      <div className="max-h-32 overflow-y-auto space-y-1 border rounded p-2 bg-background">
        {selectedFiles.map((file, idx) => (
          <FileListItem
            key={idx}
            file={file}
            isProcessing={processingFiles && currentFileIndex === idx}
            onRemove={() => onRemoveFile(idx)}
            disabled={processingFiles}
          />
        ))}
      </div>

      {processingFiles && (
        <div className="flex items-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Processing file {currentFileIndex + 1} of {selectedFiles.length}...
        </div>
      )}
    </div>
  );
}
