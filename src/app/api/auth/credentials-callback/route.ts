import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const { loginToken } = await request.json();

    if (!loginToken) {
      return Response.json({ error: "Missing login token" }, { status: 400 });
    }

    const code = await prisma.verificationCode.findFirst({
      where: {
        signInToken: loginToken,
        type: "login",
        signedInAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!code?.user) {
      return Response.json(
        { success: false, error: "Invalid or expired login token" },
        { status: 401 }
      );
    }

    await signIn("credentials", {
      loginToken,
      redirect: false,
    });

    return Response.json({ success: true });
  } catch (err) {
    console.error("[credentials-callback] signIn error:", err);
    return Response.json(
      { success: false, error: "Invalid or expired login token" },
      { status: 401 }
    );
  }
}
