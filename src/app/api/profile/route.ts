import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [profile, user] = await Promise.all([
    prisma.profile.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } }),
  ]);

  if (!profile) {
    return NextResponse.json(null);
  }

  return NextResponse.json({
    id: profile.id,
    user_id: profile.userId,
    full_name: profile.fullName,
    email: profile.email,
    avatar_url: profile.avatarUrl,
    role: profile.role,
    beta_features: profile.betaFeatures ? JSON.parse(profile.betaFeatures) : [],
    two_factor_enabled: user?.twoFactorEnabled ?? false,
  });
}
