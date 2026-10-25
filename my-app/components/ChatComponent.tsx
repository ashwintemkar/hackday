"use client";
import { useRef, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useChat } from "@/hooks/useChat";
import { useFileUpload } from "@/hooks/useFileUpload";
import { ChatHeader } from "@/components/chat-header";
import { ChatSidebar } from "@/components/ChatSidebar";
import { MessageList } from "@/components/MessageList";
import { ChatInput } from "@/components/ChatInput";
import { EmptyState } from "@/components/EmptyState";
import { VoiceSessionModal } from "@/components/voice/VoiceSessionModal";

export default function ChatComponent() {
  const { data: session } = useSession();
  const [voiceOpen, setVoiceOpen] = useState(false);
  const {
    messages,
    currentChat,
    loading,
    loadingMessages,
    streamingContent,
    currentSourceInfo,
    createNewChat,
    changeChat,
    sendMessage,
    editMessage,
    appendVoiceUserMessage,
    appendVoiceAssistantMessage
  } = useChat();

  const {
    selectedFiles,
    processingFiles,
    currentFileIndex,
    fileInputRef,
    handleFileSelection,
    removeFile,
    clearFiles,
    triggerFileInput,
    uploadFiles
  } = useFileUpload();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const handleCreateNewChat = async () => {
    if (!session?.user?.id) return;
    await createNewChat(session.user.id);
  };

  const handleEditMessage = async (messageId: string, content: string) => {
    await editMessage(messageId, content);
  };

  const handleVoiceUserMessage = (content: string) => {
    appendVoiceUserMessage(content);
  };

  const handleVoiceAssistantMessage = (content: string, sourceInfo?: any[]) => {
    appendVoiceAssistantMessage(content, sourceInfo || []);
  };

  return (
    <div className="flex h-screen bg-background text-foreground">
      {session?.user?.id && (
        <ChatSidebar
          userId={session.user.id}
          currentChat={currentChat}
          setCurrentChat={changeChat}
          onNewChat={handleCreateNewChat}
        />
      )}

      <div className="flex-1 flex flex-col">
        <ChatHeader />

        {!currentChat ? (
          <EmptyState onNewChat={handleCreateNewChat} />
        ) : (
          <>
            <MessageList
              messages={messages}
              streamingContent={streamingContent}
              loading={loading}
              loadingMessages={loadingMessages}
              onEditMessage={handleEditMessage}
              messagesEndRef={messagesEndRef}
              session={session}
              currentSourceInfo={currentSourceInfo}
            />

            <ChatInput
              loading={loading || loadingMessages}
              onSendMessage={sendMessage}
              selectedFiles={selectedFiles}
              processingFiles={processingFiles}
              currentFileIndex={currentFileIndex}
              fileInputRef={fileInputRef}
              onFileSelect={handleFileSelection}
              onRemoveFile={removeFile}
              onClearFiles={clearFiles}
              onTriggerFileInput={triggerFileInput}
              onUploadFiles={() => uploadFiles(currentChat!)}
              currentChat={currentChat}
              onOpenVoice={() => setVoiceOpen(true)}
            />
          </>
        )}
      </div>
      <VoiceSessionModal
        open={voiceOpen}
        chatId={currentChat}
        userId={session?.user?.id}
        onClose={() => setVoiceOpen(false)}
        onVoiceUserMessage={handleVoiceUserMessage}
        onVoiceAssistantMessage={handleVoiceAssistantMessage}
      />
    </div>
  );
}
