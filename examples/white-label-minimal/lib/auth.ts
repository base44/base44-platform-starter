import "server-only";
import { cache } from "react";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { Base44Error } from "./base44-error";

export const { handlers, auth } = NextAuth({
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
  redirectProxyUrl: process.env.AUTH_REDIRECT_PROXY_URL || undefined,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    signIn({ profile }) {
      return profile?.email_verified === true && Boolean(profile.email);
    },
  },
});

export const getSessionUser = cache(async () => {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;
  return { email, name: session?.user?.name };
});

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new Base44Error("Sign in to continue.", 401);
  return user;
}
