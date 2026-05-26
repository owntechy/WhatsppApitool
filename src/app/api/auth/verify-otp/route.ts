import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export async function POST(request: Request) {
  try {
    const { email, otp } = await request.json();

    if (!email || !otp) {
      return NextResponse.json({ error: "Email and OTP are required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const code = await prisma.verificationCode.findFirst({
      where: {
        userId: user.id,
        code: otp,
        type: "2fa",
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!code) {
      return NextResponse.json({ error: "Invalid or expired code" }, { status: 400 });
    }

    const signInToken = crypto.randomBytes(32).toString("hex");

    await prisma.verificationCode.update({
      where: { id: code.id },
      data: { consumedAt: new Date(), signInToken },
    });

    return NextResponse.json({ verified: true, signInToken });
  } catch (err) {
    console.error("[verify-otp] error:", err);
    const message = err instanceof Error ? err.message : "Something went wrong";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
