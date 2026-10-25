import { FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FileListItemProps {
    file: File;
    isProcessing: boolean;
    onRemove: () => void;
    disabled: boolean;
}

export function FileListItem({ file, isProcessing, onRemove, disabled }: FileListItemProps) {
    return (
        <div className="flex items-center justify-between text-sm border-b pb-1 last:border-0">
            <div className="flex items-center space-x-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className={isProcessing ? "font-medium text-primary" : ""}>
                    {file.name} ({(file.size / 1024).toFixed(1)} KB)
                </span>
            </div>
            {!disabled && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={onRemove}
                >
                    <X className="h-4 w-4" />
                </Button>
            )}
        </div>
    );
}