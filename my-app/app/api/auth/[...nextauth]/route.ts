import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import GithubProvider from "next-auth/providers/github";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    GithubProvider({
      clientId: process.env.GITHUB_ID!,
      clientSecret: process.env.GITHUB_SECRET!,
    }),
    ...(process.env.TEST_AUTH === 'true'
      ? [
          CredentialsProvider({
            name: 'Test Credentials',
            credentials: {
              email: { label: 'Email', type: 'text' },
              password: { label: 'Password', type: 'password' },
            },
            async authorize(credentials) {
              if (credentials?.email) {
                const id = (globalThis as any).crypto?.randomUUID
                  ? (globalThis as any).crypto.randomUUID()
                  : Math.random().toString(36).slice(2) + Date.now().toString(36);
                return {
                  id,
                  email: credentials.email,
                  name: 'Test User',
                } as any;
              }
              return null;
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub;
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
      }
      return token;
    },
    async signIn({ user, account }) {
      try {
        if (!user.email) {
          return false;
        }

        const existingUser = await prisma.user.findUnique({
          where: { email: user.email },
        });

        if (!existingUser) {
          await prisma.user.create({
            data: {
              id: user.id,
              email: user.email,
              name: user.name ?? user.email,
              image: user.image ?? null,
            },
          });
        }

        return true;
      } catch (error) {
        console.error("Error checking user:", error);
        return false;
      }
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
