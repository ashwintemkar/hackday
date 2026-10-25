interface Message {
  id: string;
  content: string;
  role: "user" | "assistant";
}

export function ChatMessage({ message }: { message: Message }) {
  return (
    <div
      className={`px-4 py-8 w-full ${
        message.role === "assistant" ? "bg-gray-50 dark:bg-gray-800/50" : ""
      }`}
    >
      <div className="max-w-3xl mx-auto flex space-x-4">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm ${
            message.role === "assistant" 
              ? "bg-green-500" 
              : "bg-blue-500"
          }`}
        >
          {message.role === "assistant" ? "AI" : "U"}
        </div>
        <div className="flex-1 space-y-2">
          <div className={`prose dark:prose-invert max-w-none ${
            message.role === "user" 
              ? "text-gray-800 dark:text-gray-200" 
              : "text-gray-700 dark:text-gray-300"
          }`}>
            {message.content}
          </div>
        </div>
      </div>
    </div>
  )
}
