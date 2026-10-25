import { useState } from "react";
import { Message } from "@prisma/client";
import { Loader2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MessageItem } from "@/components/MessageItem";
import { Session } from "next-auth";

interface ExtendedMessage extends Message {
    sourceInfo?: any[];
}

interface MessageListProps {
    messages: ExtendedMessage[];
    streamingContent: string;
    loading: boolean;
    loadingMessages: boolean;
    onEditMessage: (messageId: string, content: string) => Promise<void>;
    messagesEndRef: React.RefObject<HTMLDivElement>;
    session: Session | null;
    currentSourceInfo: any[];
}

export function MessageList({
    messages,
    streamingContent,
    loading,
    loadingMessages,
    onEditMessage,
    messagesEndRef,
    session,
    currentSourceInfo
}: MessageListProps) {
    return (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {loadingMessages ? (
                <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
            ) : (
                <>
                    {messages.map((message, index) => (
                        <MessageItem
                            key={index}
                            message={message}
                            onEditMessage={onEditMessage}
                            session={session}
                        />
                    ))}

                    {streamingContent && (
                        <div className="flex items-start space-x-3">
                            <Avatar className="h-8 w-8">
                                <AvatarFallback>AI</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 max-w-[80%] p-4 rounded-lg bg-muted">
                                <p className="text-sm whitespace-pre-wrap">
                                    {streamingContent}
                                    <span className="animate-pulse">▋</span>
                                </p>
                            </div>
                        </div>
                    )}
                </>
            )}

            {loading && !streamingContent && (
                <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
            )}
            <div ref={messagesEndRef} />
        </div>
    );
}