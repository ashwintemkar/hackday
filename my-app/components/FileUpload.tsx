import { useState } from "react";
import { Upload, X } from "lucide-react";
import { Button } from "./ui/button";
import { toast } from "@/hooks/use-toast";

interface FileUploadProps {
  chatId: string;
  onUploadComplete: () => void;
}

export default function FileUpload({
  chatId,
  onUploadComplete,
}: FileUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async () => {
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("chatId", chatId);

    setUploading(true);
    try {
      await fetch("/api/upload/init", {
        method: "POST",
        body: formData,
      });

      const response = await fetch("/api/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: chatId.replace("chat_", ""),
        }),
      });

      if (response.ok) {
        setTimeout(() => {
          toast({
            title: "File processed successfully",
            description: "Your file is ready for chat!",
            variant: "default",
          });
          onUploadComplete();
        }, 80000);
      }
    } catch (error) {
      console.error("Error uploading file:", error);
      toast({
        title: "Error processing file",
        description: "Failed to process your file. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-4 border-t border-gray-200">
      <div className="flex items-center space-x-4">
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="hidden"
          id="file-upload"
          accept=".txt,.pdf,.md"
        />
        <label
          htmlFor="file-upload"
          className="cursor-pointer flex items-center space-x-2 text-sm text-gray-600"
        >
          <Upload className="h-4 w-4" />
          <span>{file ? file.name : "Choose a file"}</span>
        </label>
        {file && (
          <>
            <Button onClick={() => setFile(null)} variant="ghost" size="sm">
              <X className="h-4 w-4" />
            </Button>
            <Button onClick={handleUpload} disabled={uploading}>
              {uploading ? "Processing..." : "Upload & Process"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
