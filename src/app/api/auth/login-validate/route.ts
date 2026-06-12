import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { email, password, signInToken } = await request.json();

    if (signInToken) {
      const code = await prisma.verificationCode.findFirst({
        where: {
          signInToken,
          consumedAt: { not: null },
          signedInAt: null,
          expiresAt: { gt: new Date() },
          type: "2fa",
        },
        include: { user: true },
      });

      if (!code?.user) {
        return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 });
      }

      const loginToken = crypto.randomBytes(32).toString("hex");

      await prisma.verificationCode.create({
        data: {
          userId: code.user.id,
          code: loginToken,
          type: "login",
          signInToken: loginToken,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        },
      });

      await prisma.verificationCode.update({
        where: { id: code.id },
        data: { signedInAt: new Date() },
      });

      return NextResponse.json({ step: "signin", loginToken });
    }

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.password) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    if (user.status === "pending") {
      return NextResponse.json({ error: "Your account is pending approval. Please wait for a superadmin to approve your account." }, { status: 403 });
    }

    if (user.status === "rejected") {
      return NextResponse.json({ error: "Your account has been rejected. Contact support for more information." }, { status: 403 });
    }

    if (user.twoFactorEnabled && user.role !== "superadmin") {
      const otp = crypto.randomInt(100000, 999999).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await prisma.verificationCode.create({
        data: {
          userId: user.id,
          code: otp,
          type: "2fa",
          expiresAt,
        },
      });

      try {
        const { sendOtpEmail } = await import("@/lib/email");
        await sendOtpEmail(user.email, otp, user.fullName ?? undefined);
      } catch (emailErr) {
        console.error("[login-validate] failed to send email:", emailErr);
      }

      if (process.env.NODE_ENV === "development") {
        console.log(`[DEV] OTP for ${user.email}: ${otp}`);
        return NextResponse.json({ step: "2fa", email: user.email, devOtp: otp });
      }

      return NextResponse.json({ step: "2fa", email: user.email });
    }

    const loginToken = crypto.randomBytes(32).toString("hex");

    await prisma.verificationCode.create({
      data: {
        userId: user.id,
        code: loginToken,
        type: "login",
        signInToken: loginToken,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    return NextResponse.json({ step: "signin", loginToken });
  } catch (err) {
    console.error("[login-validate] error:", err);
    const message = err instanceof Error ? err.message : "Something went wrong";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
