import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaMariaDb(connectionString);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  const hashedPassword = await bcrypt.hash("password123", 12);

  const email = "superadmin@demo.com";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.profile.deleteMany({ where: { userId: existing.id } });
    await prisma.user.delete({ where: { id: existing.id } });
    console.log("Removed existing superadmin.");
  }

  await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      fullName: "Super User",
      role: "superadmin",
      twoFactorEnabled: false,
      status: "active",
      profiles: {
        create: {
          fullName: "Super User",
          email,
          role: "superadmin",
        },
      },
    },
  });

  console.log("\n✅ Seed complete!");
  console.log("   superadmin@demo.com / password123  (superadmin)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
