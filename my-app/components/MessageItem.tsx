import { useState } from "react";
import { Message } from "@prisma/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Session } from "next-auth";
import { X } from "lucide-react";

interface ExtendedMessage extends Message {
    sourceInfo?: any[];
}

interface MessageItemProps {
    message: ExtendedMessage;
    onEditMessage: (messageId: string, content: string) => Promise<void>;
    session: Session | null;
}

export function MessageItem({ message, onEditMessage, session }: MessageItemProps) {
    const [editingContent, setEditingContent] = useState("");
    const [isEditing, setIsEditing] = useState(false);
    const [showSourceInfo, setShowSourceInfo] = useState(false);

    const handleStartEditing = () => {
        setEditingContent(message.content);
        setIsEditing(true);
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
        setEditingContent("");
    };

    const handleSaveEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        await onEditMessage(message.id, editingContent);
        setIsEditing(false);
    };

    const toggleSourceInfo = () => {
        setShowSourceInfo(!showSourceInfo);
    };

    const renderSourceInfo = () => {
        if (!message.sourceInfo || message.sourceInfo.length === 0) {
            return <div className="text-sm p-3 bg-muted/50 rounded mt-2">No source information available</div>;
        }

        return (
            <div className="text-sm mt-2 bg-muted/50 p-3 rounded space-y-3">
                <div className="flex justify-between items-center">
                    <h3 className="font-bold text-primary">Source Information</h3>
                    <Button variant="ghost" size="sm" onClick={toggleSourceInfo} className="h-6 w-6 p-0">
                        <X className="h-4 w-4" />
                    </Button>
                </div>
                {message.sourceInfo.map((source, index) => (
                    <div key={index} className="space-y-2 border-l-2 border-primary/50 pl-2">
                        <div className="flex justify-between">
                            <span className="font-medium">Source {source.index}</span>
                            <span className="text-xs bg-primary/10 px-2 rounded-full">{source.source}</span>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                                <span className="font-medium block">Chunk ID:</span>
                                <code className="bg-muted p-1 rounded text-xs">{source.chunkId}</code>
                            </div>
                            <div>
                                <span className="font-medium block">Score:</span>
                                <code className="bg-muted p-1 rounded text-xs">{source.score?.toFixed(4) || 'N/A'}</code>
                            </div>
                        </div>
                        
                        {(source.pageNumber || source.pageNumber === 0) && (
                            <div className="text-xs">
                                <span className="font-medium">Page:</span> {source.pageNumber + 1}{source.totalPages ? ` of ${source.totalPages}` : ''}
                            </div>
                        )}
                        
                        {source.prevChunkId && (
                            <div className="text-xs">
                                <span className="font-medium">Previous Chunk:</span> {source.prevChunkId}
                            </div>
                        )}
                        
                        {source.nextChunkId && (
                            <div className="text-xs">
                                <span className="font-medium">Next Chunk:</span> {source.nextChunkId}
                            </div>
                        )}
                        
                        <div className="space-y-1 mt-2">
                            <details className="text-xs cursor-pointer">
                                <summary className="font-medium">Previous Content</summary>
                                <div className="p-1 bg-muted mt-1 rounded whitespace-pre-wrap">{source.prev || 'No previous content'}</div>
                            </details>
                            
                            <details className="text-xs cursor-pointer">
                                <summary className="font-medium">Current Content</summary>
                                <div className="p-1 bg-muted mt-1 rounded whitespace-pre-wrap">{source.current || 'No content'}</div>
                            </details>
                            
                            <details className="text-xs cursor-pointer">
                                <summary className="font-medium">Next Content</summary>
                                <div className="p-1 bg-muted mt-1 rounded whitespace-pre-wrap">{source.next || 'No next content'}</div>
                            </details>
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div
            className={`flex items-start space-x-3 ${message.role === "user" ? "justify-end" : "justify-start"
                }`}
        >
            {message.role !== "user" && (
                <Avatar className="h-8 w-8">
                    <AvatarFallback>AI</AvatarFallback>
                </Avatar>
            )}
            <div
                className={`flex-1 max-w-[80%] p-4 rounded-lg ${message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
            >
                {isEditing ? (
                    <form onSubmit={handleSaveEdit}>
                        <textarea
                            value={editingContent}
                            onChange={(e) => setEditingContent(e.target.value)}
                            className="w-full p-2 border bg-primary text-primary-foreground rounded"
                        />
                        <div className="flex justify-end gap-2 mt-2">
                            <Button type="submit">Save</Button>
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={handleCancelEdit}
                            >
                                Cancel
                            </Button>
                        </div>
                    </form>
                ) : (
                    <>
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                        
                        <div className="flex justify-end gap-2 mt-2">
                            {message.role === "user" && !isEditing && (
                                <Button variant="ghost" size="sm" onClick={handleStartEditing}>
                                    Edit
                                </Button>
                            )}
                            
                            {message.role === "assistant" && message.sourceInfo && message.sourceInfo.length > 0 && (
                                <Button 
                                    variant="outline" 
                                    size="sm" 
                                    onClick={toggleSourceInfo}
                                    className="text-xs"
                                >
                                    {showSourceInfo ? "Hide Source" : "Show Source"}
                                </Button>
                            )}
                        </div>
                        
                        {showSourceInfo && message.role === "assistant" && renderSourceInfo()}
                    </>
                )}
            </div>
            {message.role === "user" && (
                <Avatar className="h-8 w-8">
                    <AvatarImage src={session?.user?.image || ""} />
                    <AvatarFallback>{session?.user?.name?.[0]}</AvatarFallback>
                </Avatar>
            )}
        </div>
    );
}