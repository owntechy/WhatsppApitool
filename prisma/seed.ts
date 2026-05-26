import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaMariaDb(connectionString);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  // ── User ────────────────────────────────────────────────
  const hashedPassword = await bcrypt.hash("password123", 12);

  for (const email of ["superuser@demo.com", "admin@demo.com"]) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await prisma.contactTag.deleteMany({ where: { contact: { userId: existing.id } } });
      await prisma.message.deleteMany({ where: { conversation: { userId: existing.id } } });
      await prisma.conversation.deleteMany({ where: { userId: existing.id } });
      await prisma.deal.deleteMany({ where: { userId: existing.id } });
      await prisma.pipelineStage.deleteMany({ where: { pipeline: { userId: existing.id } } });
      await prisma.pipeline.deleteMany({ where: { userId: existing.id } });
      await prisma.tag.deleteMany({ where: { userId: existing.id } });
      await prisma.contact.deleteMany({ where: { userId: existing.id } });
      await prisma.profile.deleteMany({ where: { userId: existing.id } });
      await prisma.user.delete({ where: { id: existing.id } });
    }
  }
  console.log("Removed existing demo data.");

  const [superuser, user] = await Promise.all([
    prisma.user.create({
      data: {
        email: "superuser@demo.com",
        password: hashedPassword,
        fullName: "Super User",
        role: "superuser",
        profiles: {
          create: {
            fullName: "Super User",
            email: "superuser@demo.com",
            role: "superuser",
          },
        },
      },
    }),
    prisma.user.create({
      data: {
        email: "admin@demo.com",
        password: hashedPassword,
        fullName: "Admin User",
        role: "admin",
        profiles: {
          create: {
            fullName: "Admin User",
            email: "admin@demo.com",
            role: "admin",
          },
        },
      },
    }),
  ]);
  console.log(`Created users: ${superuser.email} (superuser), ${user.email} (admin)`);

  // ── Tags ────────────────────────────────────────────────
  const tagNames = [
    { name: "VIP", color: "#f59e0b" },
    { name: "Hot Lead", color: "#ef4444" },
    { name: "Cold Lead", color: "#6b7280" },
    { name: "New", color: "#3b82f6" },
    { name: "Follow-up", color: "#8b5cf6" },
  ];

  const tags: Record<string, string> = {};
  for (const t of tagNames) {
    const tag = await prisma.tag.create({ data: { userId: user.id, ...t } });
    tags[t.name] = tag.id;
  }
  console.log(`Created ${tagNames.length} tags`);

  // ── Contacts ────────────────────────────────────────────
  const contactData = [
    { phone: "+14155550101", name: "Sarah Johnson", company: "Acme Corp", email: "sarah@acme.com" },
    { phone: "+14155550102", name: "Mike Chen", company: "TechFlow Inc", email: "mike@techflow.io" },
    { phone: "+14155550103", name: "Emily Rodriguez", company: "BrightSide Co", email: "emily@brightside.co" },
    { phone: "+14155550104", name: "James Wilson", company: "Wilson & Sons", email: "james@wilson.com" },
    { phone: "+14155550105", name: "Priya Patel", company: "InnovateX", email: "priya@innovatex.com" },
    { phone: "+14155550106", name: "David Kim", company: "GreenLeaf Inc", email: "david@greenleaf.com" },
    { phone: "+14155550107", name: "Lisa Thompson", company: "Thompson Media", email: "lisa@thompsonmedia.com" },
    { phone: "+14155550108", name: "Carlos Mendez", company: "Mendez Consulting", email: "carlos@mendezconsult.com" },
    { phone: "+14155550109", name: "Aisha Williams", company: "Williams Financial", email: "aisha@williamsfin.com" },
    { phone: "+14155550110", name: "Tom Baker", company: "Baker's Delight", email: "tom@bakersdelight.com" },
  ];

  const contacts: Awaited<ReturnType<typeof prisma.contact.create>>[] = [];
  for (const c of contactData) {
    const contact = await prisma.contact.create({ data: { userId: user.id, ...c } });
    contacts.push(contact);
  }
  console.log(`Created ${contacts.length} contacts`);

  // ── Contact Tags ────────────────────────────────────────
  await prisma.contactTag.createMany({
    data: [
      { contactId: contacts[0].id, tagId: tags["VIP"] },
      { contactId: contacts[0].id, tagId: tags["Hot Lead"] },
      { contactId: contacts[1].id, tagId: tags["Hot Lead"] },
      { contactId: contacts[3].id, tagId: tags["New"] },
      { contactId: contacts[4].id, tagId: tags["Follow-up"] },
    ],
  });

  // ── Pipeline ────────────────────────────────────────────
  const pipeline = await prisma.pipeline.create({
    data: {
      userId: user.id,
      name: "Sales Pipeline",
      stages: {
        createMany: {
          data: [
            { name: "Lead", position: 0, color: "#6b7280" },
            { name: "Qualified", position: 1, color: "#3b82f6" },
            { name: "Proposal", position: 2, color: "#8b5cf6" },
            { name: "Negotiation", position: 3, color: "#f59e0b" },
            { name: "Closed Won", position: 4, color: "#22c55e" },
            { name: "Closed Lost", position: 5, color: "#ef4444" },
          ],
        },
      },
    },
    include: { stages: true },
  });
  console.log(`Created pipeline "${pipeline.name}" with ${pipeline.stages.length} stages`);

  // ── Deals ───────────────────────────────────────────────
  const stageMap: Record<string, string> = {};
  for (const s of pipeline.stages) {
    stageMap[s.name] = s.id;
  }

  await prisma.deal.createMany({
    data: [
      { userId: user.id, pipelineId: pipeline.id, stageId: stageMap["Lead"], contactId: contacts[0].id, title: "Enterprise Plan - Acme Corp", value: 50000, notes: "Interested in enterprise plan with dedicated support." },
      { userId: user.id, pipelineId: pipeline.id, stageId: stageMap["Qualified"], contactId: contacts[1].id, title: "SaaS Integration - TechFlow", value: 15000, notes: "Looking to integrate our WhatsApp solution into their platform." },
      { userId: user.id, pipelineId: pipeline.id, stageId: stageMap["Proposal"], contactId: contacts[2].id, title: "Marketing Campaign - BrightSide", value: 8500, notes: "Proposal sent for broadcast campaign management." },
      { userId: user.id, pipelineId: pipeline.id, stageId: stageMap["Negotiation"], contactId: contacts[3].id, title: "Full CRM Setup - Wilson & Sons", value: 25000, notes: "Negotiating scope — wants custom pipeline automation." },
      { userId: user.id, pipelineId: pipeline.id, stageId: stageMap["Closed Won"], contactId: contacts[4].id, title: "Growth Plan - InnovateX", value: 12000, notes: "Closed. Onboarding scheduled for next week." },
    ],
  });
  console.log("Created 5 deals");

  // ── Conversations & Messages ────────────────────────────
  const conversations: Awaited<ReturnType<typeof prisma.conversation.create>>[] = [];
  for (let i = 0; i < 5; i++) {
    const conv = await prisma.conversation.create({
      data: {
        userId: user.id,
        contactId: contacts[i].id,
        status: "open",
      },
    });
    conversations.push(conv);
  }

  const messageData = [
    { convIdx: 0, text: "Hi! I'm interested in your enterprise plan. Can you tell me more about pricing?", sender: "contact" },
    { convIdx: 0, text: "Hi Sarah! Absolutely — our enterprise plan starts at $50k/year with dedicated support, custom integrations, and SLA. Would you like a demo?", sender: "agent" },
    { convIdx: 0, text: "That sounds great. Can we schedule a call next Tuesday?", sender: "contact" },
    { convIdx: 1, text: "Hey, we're evaluating your API for our platform. Do you have a sandbox environment?", sender: "contact" },
    { convIdx: 1, text: "Yes Mike! We have a full sandbox environment. Let me send you the docs.", sender: "agent" },
    { convIdx: 2, text: "We need to reach our customers via WhatsApp broadcast. Can you handle 50k+ messages?", sender: "contact" },
    { convIdx: 2, text: "Absolutely Emily — our platform handles high-volume broadcasts with delivery tracking.", sender: "agent" },
    { convIdx: 3, text: "We need a full CRM setup with custom pipelines. Is that something you offer?", sender: "contact" },
    { convIdx: 3, text: "Yes James, we have a flexible pipeline builder. Happy to walk you through it.", sender: "agent" },
    { convIdx: 4, text: "We're ready to sign up for the Growth plan!", sender: "contact" },
    { convIdx: 4, text: "Excellent Priya! Let me send you the onboarding link.", sender: "agent" },
  ];

  for (const msg of messageData) {
    const conv = conversations[msg.convIdx];
    const senderId = msg.sender === "contact" ? contacts[msg.convIdx].id : user.id;
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        senderType: msg.sender === "contact" ? "contact" : "agent",
        senderId,
        contentType: "text",
        contentText: msg.text,
      },
    });
  }
  console.log(`Created ${messageData.length} messages across ${conversations.length} conversations`);

  // Update last message on conversations
  try {
    const lastMsgByConv: Record<number, string> = {};
    for (const msg of messageData) {
      lastMsgByConv[msg.convIdx] = msg.text;
    }
    for (const [idx, conv] of conversations.entries()) {
      await prisma.conversation.update({
        where: { id: conv.id },
        data: { lastMessageText: lastMsgByConv[idx], lastMessageAt: new Date() },
      });
    }
  } catch {
    console.log("(non-critical) skipped conversation last-message update");
  }

  console.log("\n✅ Seed complete!");
  console.log("   superuser@demo.com / password123  (superuser)");
  console.log("   admin@demo.com      / password123  (admin)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
