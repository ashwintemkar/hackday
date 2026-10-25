"use client";

// components/chat-header.tsx
import { ThemeToggle } from "./theme-toggle";
import { UserNav } from "./user-nav";

export function ChatHeader() {
  return (
    <div className="border-b">
      <div className="flex h-16 items-center px-4 justify-between">
        <div className="font-semibold text-xl">RAG</div>
        <div className="flex items-center space-x-4">
          <ThemeToggle />
          <UserNav />
        </div>
      </div>
    </div>
  );
}
