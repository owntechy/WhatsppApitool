import { prisma } from "@/lib/prisma";

export function supabaseAdmin() {
  return prisma;
}
