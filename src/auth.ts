import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        loginToken: { label: "Login Token", type: "hidden" },
      },
      async authorize(credentials) {
        const loginToken = credentials?.loginToken as string | undefined;
        if (!loginToken) return null;

        const code = await prisma.verificationCode.findFirst({
          where: {
            signInToken: loginToken,
            type: "login",
            signedInAt: null,
            expiresAt: { gt: new Date() },
          },
          include: { user: true },
        });

        if (!code || !code.user) return null;

        await prisma.verificationCode.update({
          where: { id: code.id },
          data: { signedInAt: new Date() },
        });

        return {
          id: code.user.id,
          email: code.user.email,
          name: code.user.fullName,
          image: code.user.image,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id!;
      }
      if (trigger === "signIn" || trigger === "signUp" || (token.id && token.twoFactorEnabled === undefined)) {
        const dbUser = await prisma.user.findUnique({
          where: { id: (token.id || user?.id)! },
          select: { twoFactorEnabled: true },
        });
        if (dbUser) {
          token.twoFactorEnabled = dbUser.twoFactorEnabled;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.twoFactorEnabled = token.twoFactorEnabled as boolean;
      }
      return session;
    },
  },
});
