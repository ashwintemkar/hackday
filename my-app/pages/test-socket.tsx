import { useEffect, useState } from "react";
import { io } from "socket.io-client";

export default function TestSocket() {
  const [status, setStatus] = useState("disconnected");
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    const socket = io({
      path: "/api/socket",
      transports: ["websocket"],
      timeout: 20000,
    });

    socket.on("connect", () => {
      setStatus("connected");
      setLogs((prev) => [...prev, `Connected: ${socket.id}`]);
    });

    socket.on("connect_error", (err) => {
      setStatus("error");
      setLogs((prev) => [...prev, `Error: ${err.message}`]);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-semibold">Socket.IO Test</h1>
      <p>
        Status: <strong>{status}</strong>
      </p>
      <div className="space-y-1">
        {logs.map((log, i) => (
          <p key={i} className="font-mono text-sm">
            {log}
          </p>
        ))}
      </div>
    </div>
  );
}
