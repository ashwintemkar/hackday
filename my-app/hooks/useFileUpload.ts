import { useState, useRef } from "react";
import { fileService } from "@/services/api";
import { toast } from "@/hooks/use-toast";

export function useFileUpload() {
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [processingFiles, setProcessingFiles] = useState<boolean>(false);
    const [currentFileIndex, setCurrentFileIndex] = useState<number>(0);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelection = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files) {
            setSelectedFiles(Array.from(files));
        }
    };

    const removeFile = (index: number) => {
        setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    };

    const clearFiles = () => {
        setSelectedFiles([]);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const triggerFileInput = () => {
        fileInputRef.current?.click();
    };

    const uploadFiles = async (chatId: string) => {
        if (!chatId || selectedFiles.length === 0) return false;

        setProcessingFiles(true);

        try {
            for (let i = 0; i < selectedFiles.length; i++) {
                setCurrentFileIndex(i);
                await fileService.uploadFile(selectedFiles[i], chatId);
            }

            // Use createEmbeddings directly without checking for file paths
            await fileService.createEmbeddings(chatId);

            toast({
                title: "Files uploaded successfully",
                description: `${selectedFiles.length} file(s) have been processed`,
                variant: "default",
            });

            clearFiles();
            return true;
        } catch (error) {
            console.error("Error uploading files:", error);
            toast({
                title: "Error uploading files",
                description: "Please try again later",
                variant: "destructive",
            });
            setSelectedFiles([]);
            return false;
        } finally {
            setProcessingFiles(false);
            setCurrentFileIndex(0);
        }
    };

    return {
        selectedFiles,
        processingFiles,
        currentFileIndex,
        fileInputRef,
        handleFileSelection,
        removeFile,
        clearFiles,
        triggerFileInput,
        uploadFiles
    };
}