import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import {
  Plus,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Trash2,
} from "lucide-react";
import { Chat, Message } from "@prisma/client";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRouter } from "next/navigation";

interface ChatSidebarProps {
  userId: string;
  currentChat: string | null;
  setCurrentChat: (chatId: string | null) => void;
  onNewChat: () => void;
}

interface ChatWithMessages extends Chat {
  messages: Message[];
}

export function ChatSidebar({
  userId,
  currentChat,
  setCurrentChat,
  onNewChat,
}: ChatSidebarProps) {
  const router = useRouter();
  const [chats, setChats] = useState<ChatWithMessages[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    const fetchChats = async () => {
      try {
        const response = await fetch("/api/chat/list");
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setChats(data);
      } catch (error) {
        console.error("Error fetching chats:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchChats();
  }, [userId, currentChat]);

  const handleDeleteChat = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this chat?")) return;

    try {
      const response = await fetch(`/api/chat/${chatId}/delete`, {
        method: "DELETE",
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete chat");
      }
      
      const updatedChats = chats.filter((chat) => chat.id !== chatId);
      setChats(updatedChats);
      
      if (currentChat === chatId) {
        if (updatedChats.length > 0) {
          setCurrentChat(updatedChats[0].id);
        } else {
          setCurrentChat(null);
          setTimeout(() => {
            onNewChat();
          }, 100);
        }
      }
      
      router.refresh();
    } catch (error) {
      console.error("Error deleting chat:", error);
      alert("Error deleting chat: " + (error instanceof Error ? error.message : "Unknown error"));
    }
  };

  const getLastMessage = (chat: ChatWithMessages) => {
    if (chat.messages && chat.messages.length > 0) {
      const lastMessage = chat.messages[chat.messages.length - 1];
      return (
        lastMessage.content.slice(0, 30) +
        (lastMessage.content.length > 30 ? "..." : "")
      );
    }
    return "No messages";
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString();
  };

  return (
    <div
      className={cn(
        "relative h-full bg-background border-r border-border transition-all duration-300",
        isCollapsed ? "w-16" : "w-64"
      )}
    >
      <Button
        onClick={() => setIsCollapsed(!isCollapsed)}
        variant="ghost"
        size="sm"
        className="absolute -right-4 top-2 z-10 h-8 w-8 rounded-full border"
      >
        {isCollapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </Button>

      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          {!isCollapsed && <h2 className="text-xl font-semibold">Chats</h2>}
          <Button
            onClick={onNewChat}
            size="sm"
            className={cn("p-0", isCollapsed ? "w-8 h-8" : "w-8 h-8")}
            variant="ghost"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2">
          {loading ? (
            <div className="flex items-center justify-center h-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
            </div>
          ) : chats.length === 0 ? (
            <div className="text-center text-muted-foreground mt-4">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
              {!isCollapsed && <p>No chats yet</p>}
            </div>
          ) : (
            <ul className="space-y-2">
              {chats.map((chat) => (
                <li
                  key={chat.id}
                  onClick={() => setCurrentChat(chat.id)}
                  className={cn(
                    "rounded-lg cursor-pointer transition-all",
                    "hover:bg-accent/50",
                    currentChat === chat.id
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground",
                    isCollapsed ? "p-2" : "p-3"
                  )}
                >
                  <div className="flex items-center space-x-3">
                    <MessageSquare className="h-4 w-4 flex-shrink-0" />
                    {!isCollapsed && (
                      <div className="flex-1 overflow-hidden">
                        <p className="font-medium truncate">
                          {chat.name || `Chat ${formatDate(chat.createdAt)}`}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {getLastMessage(chat)}
                        </p>
                      </div>
                    )}
                    {!isCollapsed && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={(e) => handleDeleteChat(chat.id, e)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
