import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

// Mark page as dynamic because getServerSession relies on request headers.
export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getServerSession();

  // If user is not logged in, redirect to sign in
  if (!session) {
    redirect("/signin");
  }

  // If user is logged in, redirect to chat
  redirect("/chat");
}
