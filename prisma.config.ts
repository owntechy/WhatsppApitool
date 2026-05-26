import { defineConfig } from "prisma/config";

const datasourceUrl = process.env.DATABASE_URL as string;

export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    url: datasourceUrl,
  },
  migrations: {
    path: "./prisma/migrations",
    seed: "npx tsx prisma/seed.ts",
  },
});
