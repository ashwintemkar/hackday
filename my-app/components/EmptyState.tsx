import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
    onNewChat: () => void;
}

export function EmptyState({ onNewChat }: EmptyStateProps) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center">
            <div className="text-center space-y-4">
                <h2 className="text-2xl font-bold">Welcome to RAG Chat</h2>
                <p className="text-muted-foreground">
                    Start a new conversation to begin chatting with your documents
                </p>
                <Button onClick={onNewChat} className="mt-4">
                    <Plus className="h-4 w-4 mr-2" />
                    Start New Chat
                </Button>
            </div>
        </div>
    );
}