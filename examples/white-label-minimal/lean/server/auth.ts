import "server-only";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Tiny's own sign-in: Google through Auth.js, the session in a cookie. Base44 never sees it.
export const { handlers, auth, signIn } = NextAuth({
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
  redirectProxyUrl: process.env.AUTH_REDIRECT_PROXY_URL || undefined,
  providers: [Google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET })],
  callbacks: { signIn: ({ profile }) => profile?.email_verified === true },
});
