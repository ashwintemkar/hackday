import { useState, useEffect, useCallback } from "react";
import { Message } from "@prisma/client";
import { messageService, chatService } from "@/services/api";
import { toast } from "@/hooks/use-toast";

interface ExtendedMessage extends Message {
  sourceInfo?: any[];
}

export function useChat(initialChatId: string | null = null) {
  const [messages, setMessages] = useState<ExtendedMessage[]>([]);
  const [currentChat, setCurrentChat] = useState<string | null>(initialChatId);
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [chats, setChats] = useState<any[]>([]);
  const [currentSourceInfo, setCurrentSourceInfo] = useState<any[]>([]);

  const loadChats = useCallback(async () => {
    try {
      const fetchedChats = await chatService.fetchChats();
      setChats(fetchedChats);
    } catch (error) {
      console.error("Error fetching chats:", error);
      toast({
        title: "Error loading chats",
        description: "Unable to fetch your conversations",
        variant: "destructive",
      });
    }
  }, []);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  const refreshCurrentChatMessages = useCallback(async () => {
    if (!currentChat) return;
    setLoadingMessages(true);
    try {
      const fetchedMessages = await messageService.fetchMessages(currentChat);
      setMessages(fetchedMessages || []);
    } catch (error) {
      console.error("Error fetching messages:", error);
      setMessages([]);
      toast({
        title: "Error loading messages",
        description: "Unable to load conversation messages",
        variant: "destructive",
      });
    } finally {
      setLoadingMessages(false);
    }
  }, [currentChat]);

  useEffect(() => {
    if (!currentChat) return;
    refreshCurrentChatMessages();
  }, [currentChat, refreshCurrentChatMessages]);

  const createNewChat = useCallback(async (userId: string) => {
    try {
      const { id } = await chatService.createChat(userId);
      setCurrentChat(id);
      setMessages([]);
      setStreamingContent("");
      setCurrentSourceInfo([]);
      await loadChats();
      toast({
        title: "New conversation started",
        description: "You can now start chatting",
        variant: "default",
      });
      return id;
    } catch (error) {
      console.error("Error creating chat:", error);
      toast({
        title: "Error creating conversation",
        description: "Please try again later",
        variant: "destructive",
      });
      return null;
    }
  }, [loadChats]);
  
  const deleteChat = useCallback(async (chatId: string, userId: string) => {
    try {
      await chatService.deleteChat(chatId);

      if (chatId === currentChat) {
        const newChatId = await createNewChat(userId);
        setCurrentChat(newChatId);
      }

      await loadChats();
      toast({
        title: "Conversation deleted",
        description: "The conversation has been removed",
        variant: "default",
      });
    } catch (error) {
      console.error("Error deleting chat:", error);
      toast({
        title: "Error deleting conversation",
        description: "Unable to delete the conversation",
        variant: "destructive",
      });
    }
  }, [currentChat, createNewChat, loadChats]);

  const changeChat = useCallback((chatId: string | null) => {
    setCurrentChat(chatId);
    setStreamingContent("");
    setMessages([]);
    setCurrentSourceInfo([]);
  }, []);


  const sendMessage = useCallback(async (content: string, overrideChat?: string) => {
    const chatId = overrideChat || currentChat;
    if (!content.trim() || !chatId) return;

    setLoading(true);
    setStreamingContent("");
    setCurrentSourceInfo([]);

    try {
      await messageService.createMessage(content, chatId, "user");

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "user",
          content,
          createdAt: new Date(),
          chatId,
        } as Message,
      ]);

      const response = await chatService.streamResponse(
        content,
        chatId,
        (chunk) => setStreamingContent(chunk)
      );

      const responseObj = response as unknown as { content: string; sourceInfo: any[] };
      const responseContent = responseObj.content || response.toString();
      const sourceInfo = responseObj.sourceInfo || [];
      setCurrentSourceInfo(sourceInfo);

      await messageService.createMessage(responseContent, chatId, "assistant");

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: responseContent,
          createdAt: new Date(),
          chatId,
          sourceInfo,
        } as ExtendedMessage,
      ]);

      await loadChats();
      return responseContent;
    } catch (error) {
      console.error("Error sending message:", error);
      toast({
        title: "Error sending message",
        description: "Your message could not be processed",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setStreamingContent("");
    }
  }, [currentChat, loadChats]);

  const editMessage = useCallback(async (messageId: string, newContent: string) => {
    try {
      const messageIndex = messages.findIndex(m => m.id === messageId);
      if (messageIndex === -1) return;

      const message = messages[messageIndex];

      if (message.role !== "user") return;

      const result = await messageService.editMessage(messageId, newContent);

      setMessages(prev => {
        const updatedMessages = prev.slice(0, messageIndex + 1);
        updatedMessages[messageIndex] = { ...message, content: newContent };
        return updatedMessages;
      });

      if (currentChat) {
        setLoading(true);
        setStreamingContent("");
        setCurrentSourceInfo([]);

        try {
          const response = await chatService.streamResponse(
            newContent,
            currentChat,
            (chunk) => setStreamingContent(chunk)
          );

          const responseObj = response as unknown as { content: string; sourceInfo: any[] };
          const responseContent = responseObj.content || response.toString();
          const sourceInfo = responseObj.sourceInfo || [];
          setCurrentSourceInfo(sourceInfo);

          await messageService.createMessage(responseContent, currentChat, "assistant");

          setMessages(prev => [
            ...prev,
            {
              id: Date.now().toString(),
              role: "assistant",
              content: responseContent,
              createdAt: new Date(),
              chatId: currentChat,
              sourceInfo,
            } as ExtendedMessage
          ]);

          await loadChats();
          toast({
            title: "Message updated",
            description: "Your message has been edited successfully",
            variant: "default",
          });
        } catch (error) {
          console.error("Error generating response:", error);
          toast({
            title: "Error updating response",
            description: "Could not generate a new response",
            variant: "destructive",
          });
        } finally {
          setLoading(false);
          setStreamingContent("");
        }
      }
    } catch (error) {
      console.error("Error updating message:", error);
      toast({
        title: "Error updating message",
        description: "Your message could not be updated",
        variant: "destructive",
      });
    }
  }, [messages, currentChat, loadChats]);

  const appendVoiceUserMessage = useCallback(
    (content: string) => {
      if (!currentChat) return;
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-voice-user`,
          role: "user",
          content,
          createdAt: new Date(),
          chatId: currentChat,
        } as Message,
      ]);
    },
    [currentChat]
  );

  const appendVoiceAssistantMessage = useCallback(
    (content: string, sourceInfo: any[] = []) => {
      if (!currentChat) return;
      setCurrentSourceInfo(sourceInfo);
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-voice-assistant`,
          role: "assistant",
          content,
          createdAt: new Date(),
          chatId: currentChat,
          sourceInfo,
        } as ExtendedMessage,
      ]);
      loadChats();
    },
    [currentChat, loadChats]
  );

  return {
    messages,
    currentChat,
    loading,
    loadingMessages,
    streamingContent,
    chats,
    currentSourceInfo,
    createNewChat,
    changeChat,
    sendMessage,
    editMessage,
    deleteChat,
    loadChats,
    appendVoiceUserMessage,
    appendVoiceAssistantMessage,
    refreshCurrentChatMessages
  };
}
