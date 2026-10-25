import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "../api/auth/[...nextauth]/route";
import ChatComponent from "@/components/ChatComponent";

// Force dynamic rendering because getServerSession reads request headers.
export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/signin");
  }

  return <ChatComponent />;
}
