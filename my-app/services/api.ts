import { Message } from "@prisma/client";

export const messageService = {
  async fetchMessages(chatId: string): Promise<Message[]> {
    const response = await fetch(`/api/messages/chatMessages/${chatId}`);

    if (!response.ok) {
      if (response.status === 404) {
        return [];
      }
      if (response.status === 400) {
        console.warn(`Bad request for chatId ${chatId}, returning empty messages`);
        return [];
      }
      throw new Error(`Failed to fetch messages: ${response.status}`);
    }

    const data = await response.json();
    return data.messages || [];
  },

  
  async createMessage(content: string, chatId: string, role: "user" | "assistant"): Promise<void> {
    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, chatId, role }),
    });

    if (!response.ok) {
      throw new Error("Failed to create message");
    }
  },

  async editMessage(messageId: string, content: string): Promise<{ success: boolean; deletedCount: number }> {
    const response = await fetch(`/api/messages/${messageId}/edit`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) throw new Error("Failed to update message");
    return await response.json();
  },
};

export const chatService = {
  async createChat(userId: string): Promise<{ id: string; folder: string }> {
    const response = await fetch("/api/chat/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }

    return { id: data.id, folder: data.folder };
  },

  async deleteChat(chatId: string): Promise<void> {
    const response = await fetch(`/api/chat/${chatId}/delete`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Failed to delete chat");
    }
  },

  async fetchChats(): Promise<any[]> {
    const response = await fetch("/api/chat/list");
    if (!response.ok) throw new Error("Failed to fetch chats");
    return await response.json();
  },

  async streamResponse(query: string, chatId: string, onChunk: (chunk: string) => void): Promise<string> {
    let sourceInfo: any[] = [];
    
    const response = await fetch("/api/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, chatId }),
    });

    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulatedContent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      
      // Check if the chunk is a source info chunk
      if (chunk.startsWith('{"type":"source-info"')) {
        try {
          const jsonEndIndex = chunk.indexOf('\n');
          if (jsonEndIndex !== -1) {
            const jsonStr = chunk.substring(0, jsonEndIndex);
            const data = JSON.parse(jsonStr);
            if (data.type === 'source-info') {
              sourceInfo = data.data;
              // Continue processing the rest of the chunk
              const remaining = chunk.substring(jsonEndIndex + 1);
              if (remaining) {
                accumulatedContent += remaining;
                onChunk(accumulatedContent);
              }
            }
          }
        } catch (e) {
          console.error("Error parsing source info:", e);
          accumulatedContent += chunk;
          onChunk(accumulatedContent);
        }
      } else {
        accumulatedContent += chunk;
        onChunk(accumulatedContent);
      }
    }

    return {
      toString: () => accumulatedContent,
      content: accumulatedContent,
      sourceInfo
    } as unknown as string;
  }
};


export const fileService = {
  async uploadFile(file: File, chatId: string): Promise<void> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("chatId", chatId);

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload ${file.name}`);
    }
  },

  async createEmbeddings(chatId: string, filePath?: string): Promise<void> {
    const result = await fetch("/api/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chatId, filePath }),
    });

    if (!result.ok) {
      throw new Error("Failed to process files");
    }
  }
}

export type TicketToolsPayload = {
  summary: string;
  description: string;
  comment?: string;
  attachment?: string;
};

export const ticketToolsService = {
  async embedShowtech(ticketText: string, previousVector?: number[]) {
    const response = await fetch("/api/ticket-tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "showtech", ticketText, previousVector }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || "Failed to embed showtech output");
    }

    return data as {
      embedding: number[];
      similarity?: number | null;
      isDuplicate?: boolean;
    };
  },

  async summarizeAndEmbed(ticket: TicketToolsPayload, previousVector?: number[]) {
    const response = await fetch("/api/ticket-tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "summarize", ticket, previousVector }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || "Failed to summarize ticket");
    }

    return data as {
      summary: string;
      embedding: number[];
      similarity?: number | null;
      isDuplicate?: boolean;
    };
  },
};
