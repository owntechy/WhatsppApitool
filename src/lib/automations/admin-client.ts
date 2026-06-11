import { prisma } from "@/lib/prisma";

export function prismaClient() {
  return prisma;
}
