import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import {
  GithubSignInButton,
  GoogleSignInButton,
} from "@/components/ui/authButtons";

// Force dynamic rendering because getServerSession depends on headers.
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const session = await getServerSession(authOptions);

  if (session) {
    redirect("/chat");
  }

  return (
    <div className="w-full flex flex-col items-center justify-center min-h-screen py-2">
      <div className="flex flex-col items-center mt-10 p-10 shadow-md">
        <h1 className="mt-10 mb-4 text-4xl font-bold">Sign In</h1>
        <GoogleSignInButton />
        <GithubSignInButton />
      </div>
    </div>
  );
}
