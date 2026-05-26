import "dotenv/config";
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

  for (const email of ["superadmin@demo.com", "admin@demo.com"]) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await prisma.flowRunEvent.deleteMany({ where: { flowRun: { flow: { userId: existing.id } } } });
      await prisma.flowRun.deleteMany({ where: { flow: { userId: existing.id } } });
      await prisma.flowNode.deleteMany({ where: { flow: { userId: existing.id } } });
      await prisma.flow.deleteMany({ where: { userId: existing.id } });
      await prisma.automationPendingExecution.deleteMany({ where: { userId: existing.id } });
      await prisma.automationLog.deleteMany({ where: { automation: { userId: existing.id } } });
      await prisma.automationStep.deleteMany({ where: { automation: { userId: existing.id } } });
      await prisma.automation.deleteMany({ where: { userId: existing.id } });
      await prisma.broadcastRecipient.deleteMany({ where: { broadcast: { userId: existing.id } } });
      await prisma.broadcast.deleteMany({ where: { userId: existing.id } });
      await prisma.messageTemplate.deleteMany({ where: { userId: existing.id } });
      await prisma.whatsAppConfig.deleteMany({ where: { userId: existing.id } });
      await prisma.messageReaction.deleteMany({ where: { conversation: { userId: existing.id } } });
      await prisma.message.deleteMany({ where: { conversation: { userId: existing.id } } });
      await prisma.conversation.deleteMany({ where: { userId: existing.id } });
      await prisma.deal.deleteMany({ where: { userId: existing.id } });
      await prisma.pipelineStage.deleteMany({ where: { pipeline: { userId: existing.id } } });
      await prisma.pipeline.deleteMany({ where: { userId: existing.id } });
      await prisma.contactCustomValue.deleteMany({ where: { contact: { userId: existing.id } } });
      await prisma.customField.deleteMany({ where: { userId: existing.id } });
      await prisma.contactNote.deleteMany({ where: { userId: existing.id } });
      await prisma.contactTag.deleteMany({ where: { contact: { userId: existing.id } } });
      await prisma.tag.deleteMany({ where: { userId: existing.id } });
      await prisma.contact.deleteMany({ where: { userId: existing.id } });
      await prisma.profile.deleteMany({ where: { userId: existing.id } });
      await prisma.user.delete({ where: { id: existing.id } });
    }
  }
  console.log("Removed existing demo data.");

  const [superadmin, user] = await Promise.all([
    prisma.user.create({
      data: {
        email: "superadmin@demo.com",
        password: hashedPassword,
        fullName: "Super User",
        role: "superadmin",
        profiles: {
          create: {
            fullName: "Super User",
            email: "superadmin@demo.com",
            role: "superadmin",
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
        twoFactorEnabled: true,
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
  // ── Pending users (awaiting superadmin approval) ──────
  const pendingUsers = [
    { email: "alice@example.com", fullName: "Alice Johnson" },
    { email: "bob@example.com", fullName: "Bob Smith" },
    { email: "carol@example.com", fullName: "Carol Williams" },
    { email: "dan@example.com", fullName: "Dan Brown" },
    { email: "eve@example.com", fullName: "Eve Davis" },
  ];
  for (const u of pendingUsers) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    if (!existing) {
      await prisma.user.create({
        data: {
          email: u.email,
          password: hashedPassword,
          fullName: u.fullName,
          role: "user",
          status: "pending",
          profiles: {
            create: {
              fullName: u.fullName,
              email: u.email,
              role: "user",
            },
          },
        },
      });
    }
  }
  console.log(`Created ${pendingUsers.length} pending users (awaiting approval)`);

  console.log(`Created users: ${superadmin.email} (superadmin), ${user.email} (admin)`);

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
      { userId: user.id, pipelineId: pipeline.id, stageId: stageMap["Lead"], contactId: contacts[5].id, title: "Green Initiative - GreenLeaf Inc", value: 7500, notes: "Interested in sustainability-focused features." },
      { userId: user.id, pipelineId: pipeline.id, stageId: stageMap["Qualified"], contactId: contacts[6].id, title: "Media Suite - Thompson Media", value: 18000, notes: "Needs social media integration and analytics." },
      { userId: user.id, pipelineId: pipeline.id, stageId: stageMap["Closed Lost"], contactId: contacts[7].id, title: "CRM Expansion - Mendez Consulting", value: 9500, notes: "Decided to go with a competitor. Follow up in 6 months." },
      { userId: user.id, pipelineId: pipeline.id, stageId: stageMap["Proposal"], contactId: contacts[8].id, title: "Compliance Package - Williams Financial", value: 35000, notes: "Sent proposal with compliance add-ons and dedicated support." },
      { userId: user.id, pipelineId: pipeline.id, stageId: stageMap["Negotiation"], contactId: contacts[9].id, title: "Starter Plan + - Baker's Delight", value: 4800, notes: "Negotiating annual vs monthly billing." },
    ],
  });
  console.log("Created 10 deals");

  // ── Conversations & Messages ────────────────────────────
  const conversations: Awaited<ReturnType<typeof prisma.conversation.create>>[] = [];
  for (let i = 0; i < 10; i++) {
    const conv = await prisma.conversation.create({
      data: {
        userId: user.id,
        contactId: contacts[i].id,
        status: i >= 7 ? "closed" : "open",
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
    { convIdx: 5, text: "Hi, I'm looking for eco-friendly CRM solutions. Does your platform have green hosting?", sender: "contact" },
    { convIdx: 5, text: "Hi David! Yes — we use carbon-neutral cloud infrastructure. Happy to share our sustainability report.", sender: "agent" },
    { convIdx: 6, text: "We need a media monitoring feature. Can your CRM integrate with social platforms?", sender: "contact" },
    { convIdx: 6, text: "Absolutely Lisa! We have social media integration via our API and webhook system.", sender: "agent" },
    { convIdx: 7, text: "Hola, estoy buscando una solución CRM para mi equipo en México.", sender: "contact" },
    { convIdx: 7, text: "Hola Carlos! Sí, tenemos soporte completo en español y facturación en MXN.", sender: "agent" },
    { convIdx: 8, text: "Do you have compliance certifications? We're in financial services.", sender: "contact" },
    { convIdx: 8, text: "Yes Aisha — we're SOC 2 Type II certified and GDPR compliant. Happy to share our compliance docs.", sender: "agent" },
    { convIdx: 9, text: "I run a small bakery chain. Is there a starter plan?", sender: "contact" },
    { convIdx: 9, text: "Of course Tom! We have a Starter plan at $29/month for up to 500 contacts.", sender: "agent" },
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

  // ── Custom Fields ─────────────────────────────────────────
  const customFields = await Promise.all([
    prisma.customField.create({ data: { userId: user.id, fieldName: "Industry", fieldType: "text" } }),
    prisma.customField.create({ data: { userId: user.id, fieldName: "Annual Revenue", fieldType: "number" } }),
    prisma.customField.create({ data: { userId: user.id, fieldName: "Lead Source", fieldType: "select", fieldOptions: JSON.stringify(["Website", "Referral", "LinkedIn", "Conference", "Cold Call"]) } }),
    prisma.customField.create({ data: { userId: user.id, fieldName: "Priority", fieldType: "select", fieldOptions: JSON.stringify(["Low", "Medium", "High", "Urgent"]) } }),
  ]);
  console.log(`Created ${customFields.length} custom fields`);

  // ── Contact Custom Values ─────────────────────────────────
  await prisma.contactCustomValue.createMany({
    data: [
      { contactId: contacts[0].id, customFieldId: customFields[0].id, value: "Technology" },
      { contactId: contacts[0].id, customFieldId: customFields[1].id, value: "50000000" },
      { contactId: contacts[0].id, customFieldId: customFields[2].id, value: "Website" },
      { contactId: contacts[0].id, customFieldId: customFields[3].id, value: "High" },
      { contactId: contacts[1].id, customFieldId: customFields[0].id, value: "SaaS" },
      { contactId: contacts[1].id, customFieldId: customFields[2].id, value: "LinkedIn" },
      { contactId: contacts[2].id, customFieldId: customFields[0].id, value: "Marketing" },
      { contactId: contacts[2].id, customFieldId: customFields[1].id, value: "12000000" },
      { contactId: contacts[2].id, customFieldId: customFields[3].id, value: "Medium" },
      { contactId: contacts[3].id, customFieldId: customFields[0].id, value: "Construction" },
      { contactId: contacts[4].id, customFieldId: customFields[2].id, value: "Referral" },
      { contactId: contacts[4].id, customFieldId: customFields[3].id, value: "Urgent" },
    ],
  });
  console.log("Created contact custom values");

  // ── Contact Notes ─────────────────────────────────────────
  await prisma.contactNote.createMany({
    data: [
      { contactId: contacts[0].id, userId: user.id, noteText: "Met at Tech Summit 2026. Very interested in enterprise features." },
      { contactId: contacts[0].id, userId: user.id, noteText: "Follow up needed on dedicated support SLA." },
      { contactId: contacts[1].id, userId: user.id, noteText: "Technical contact — prefers email communication." },
      { contactId: contacts[3].id, userId: user.id, noteText: "Decision maker is James Sr. — send proposal to both." },
      { contactId: contacts[4].id, userId: user.id, noteText: "Referred by existing customer. Fast mover." },
      { contactId: contacts[6].id, userId: user.id, noteText: "Interested in media partnership opportunities." },
    ],
  });
  console.log("Created contact notes");

  // ── WhatsApp Config ───────────────────────────────────────
  await prisma.whatsAppConfig.create({
    data: {
      userId: user.id,
      phoneNumberId: "123456789",
      wabaId: "987654321",
      accessToken: "mock-whatsapp-access-token",
      verifyToken: "mock-verify-token",
      status: "connected",
      connectedAt: new Date("2026-01-15"),
    },
  });
  console.log("Created WhatsApp config");

  // ── Message Templates ─────────────────────────────────────
  const templates = await Promise.all([
    prisma.messageTemplate.create({
      data: {
        userId: user.id,
        name: "welcome_message",
        category: "Marketing",
        language: "en_US",
        headerType: "text",
        headerContent: "Welcome to WA CRM!",
        bodyText: "Hi {{1}}, thank you for joining WA CRM! We're excited to have you on board. Reply HELP to learn more.",
        footerText: "Powered by WA CRM",
        status: "Approved",
      },
    }),
    prisma.messageTemplate.create({
      data: {
        userId: user.id,
        name: "order_confirmation",
        category: "Utility",
        language: "en_US",
        headerType: "text",
        headerContent: "Order Confirmed",
        bodyText: "Hi {{1}}, your order #{{2}} has been confirmed. Total: ${{3}}. We'll notify you when it ships.",
        buttons: JSON.stringify([{ type: "quick_reply", text: "Track Order" }]),
        status: "Approved",
      },
    }),
    prisma.messageTemplate.create({
      data: {
        userId: user.id,
        name: "appointment_reminder",
        category: "Utility",
        language: "en_US",
        bodyText: "Reminder: You have an appointment on {{1}} at {{2}}. Reply CONFIRM or RESCHEDULE.",
        buttons: JSON.stringify([{ type: "quick_reply", text: "Confirm" }, { type: "quick_reply", text: "Reschedule" }]),
        status: "Approved",
      },
    }),
    prisma.messageTemplate.create({
      data: {
        userId: user.id,
        name: "promotional_offer",
        category: "Marketing",
        language: "en_US",
        headerType: "text",
        headerContent: "Exclusive Offer 🎉",
        bodyText: "Hi {{1}}, enjoy {{2}} off your next purchase! Use code {{3}}. Offer valid until {{4}}.",
        footerText: "Terms & Conditions apply",
        status: "Pending",
      },
    }),
  ]);
  console.log(`Created ${templates.length} message templates`);

  // ── Broadcasts ────────────────────────────────────────────
  const [broadcast1, broadcast2] = await Promise.all([
    prisma.broadcast.create({
      data: {
        userId: user.id,
        name: "Summer Campaign 2026",
        templateName: "welcome_message",
        templateLanguage: "en_US",
        templateVariables: JSON.stringify({ "1": "name" }),
        status: "sent",
        totalRecipients: 4,
        sentCount: 4,
        deliveredCount: 3,
        readCount: 2,
        repliedCount: 1,
        createdAt: new Date("2026-05-01"),
      },
    }),
    prisma.broadcast.create({
      data: {
        userId: user.id,
        name: "Product Launch Announcement",
        templateName: "promotional_offer",
        templateLanguage: "en_US",
        templateVariables: JSON.stringify({ "1": "name", "2": "20%", "3": "LAUNCH20", "4": "June 30" }),
        audienceFilter: JSON.stringify({ tags: ["VIP", "Hot Lead"] }),
        scheduledAt: new Date("2026-06-15T10:00:00Z"),
        status: "scheduled",
        totalRecipients: 2,
      },
    }),
  ]);
  console.log(`Created ${2} broadcasts`);

  // ── Broadcast Recipients ──────────────────────────────────
  await prisma.broadcastRecipient.createMany({
    data: [
      { broadcastId: broadcast1.id, contactId: contacts[0].id, status: "sent", sentAt: new Date("2026-05-01T08:00:00Z"), deliveredAt: new Date("2026-05-01T08:01:00Z"), readAt: new Date("2026-05-01T09:00:00Z"), repliedAt: new Date("2026-05-01T09:05:00Z") },
      { broadcastId: broadcast1.id, contactId: contacts[1].id, status: "delivered", sentAt: new Date("2026-05-01T08:00:00Z"), deliveredAt: new Date("2026-05-01T08:02:00Z") },
      { broadcastId: broadcast1.id, contactId: contacts[2].id, status: "delivered", sentAt: new Date("2026-05-01T08:00:00Z"), deliveredAt: new Date("2026-05-01T08:00:30Z") },
      { broadcastId: broadcast1.id, contactId: contacts[4].id, status: "sent", sentAt: new Date("2026-05-01T08:00:00Z") },
      { broadcastId: broadcast2.id, contactId: contacts[0].id, status: "pending" },
      { broadcastId: broadcast2.id, contactId: contacts[1].id, status: "pending" },
    ],
  });
  console.log("Created broadcast recipients");

  // ── Automations ───────────────────────────────────────────
  const automation1 = await prisma.automation.create({
    data: {
      userId: user.id,
      name: "New Contact Welcome",
      description: "Automatically sends a welcome message and creates a follow-up task when a new contact is added.",
      triggerType: "contact.created",
      triggerConfig: JSON.stringify({}),
      isActive: true,
      executionCount: 5,
      lastExecutedAt: new Date("2026-05-25"),
    },
  });

  await prisma.automationStep.createMany({
    data: [
      { automationId: automation1.id, stepType: "send_message", stepConfig: JSON.stringify({ templateName: "welcome_message" }), position: 0 },
      { automationId: automation1.id, stepType: "add_tag", stepConfig: JSON.stringify({ tagName: "New" }), position: 1 },
      { automationId: automation1.id, stepType: "create_deal", stepConfig: JSON.stringify({ pipelineName: "Sales Pipeline", stageName: "Lead" }), position: 2 },
      { automationId: automation1.id, stepType: "delay", stepConfig: JSON.stringify({ duration: 86400000 }), position: 3 },
      { automationId: automation1.id, stepType: "send_message", stepConfig: JSON.stringify({ bodyText: "Hi! Just checking in — how can we help you today?" }), position: 4 },
    ],
  });

  const automation2 = await prisma.automation.create({
    data: {
      userId: user.id,
      name: "High Value Lead Alert",
      description: "Notifies team when a deal over $20k is created.",
      triggerType: "deal.created",
      triggerConfig: JSON.stringify({ minValue: 20000 }),
      isActive: true,
      executionCount: 3,
      lastExecutedAt: new Date("2026-05-20"),
    },
  });

  await prisma.automationStep.createMany({
    data: [
      { automationId: automation2.id, stepType: "notify_team", stepConfig: JSON.stringify({ channel: "email", message: "New high-value deal: {{deal.title}} (${{deal.value}})" }), position: 0 },
      { automationId: automation2.id, stepType: "add_tag", stepConfig: JSON.stringify({ tagName: "VIP" }), position: 1 },
    ],
  });

  console.log(`Created ${2} automations with steps`);

  // ── Automation Logs ───────────────────────────────────────
  await prisma.automationLog.createMany({
    data: [
      { automationId: automation1.id, userId: user.id, contactId: contacts[5].id, triggerEvent: "contact.created", stepsExecuted: JSON.stringify(["send_message", "add_tag", "create_deal"]), status: "completed", createdAt: new Date("2026-05-20") },
      { automationId: automation1.id, userId: user.id, contactId: contacts[6].id, triggerEvent: "contact.created", stepsExecuted: JSON.stringify(["send_message", "add_tag", "create_deal", "delay"]), status: "in_progress", createdAt: new Date("2026-05-25") },
      { automationId: automation2.id, userId: user.id, contactId: contacts[0].id, triggerEvent: "deal.created", stepsExecuted: JSON.stringify(["notify_team", "add_tag"]), status: "completed", createdAt: new Date("2026-05-18") },
    ],
  });
  console.log("Created automation logs");

  // ── Flows ─────────────────────────────────────────────────
  const flow = await prisma.flow.create({
    data: {
      userId: user.id,
      name: "Customer Onboarding",
      description: "Guides new contacts through product orientation and collects their preferences.",
      status: "active",
      triggerType: "message.inbound",
      triggerConfig: JSON.stringify({ keywords: ["start", "help", "onboard"] }),
      executionCount: 12,
      lastExecutedAt: new Date("2026-05-26"),
    },
  });

  const [node1, node2, node3, node4] = await Promise.all([
    prisma.flowNode.create({
      data: {
        flowId: flow.id,
        nodeKey: "welcome",
        nodeType: "send_message",
        config: JSON.stringify({ bodyText: "Welcome to onboarding! I'll help you get started. What's your name?" }),
        positionX: 100,
        positionY: 100,
      },
    }),
    prisma.flowNode.create({
      data: {
        flowId: flow.id,
        nodeKey: "collect_name",
        nodeType: "collect_input",
        config: JSON.stringify({ varName: "name", prompt: "Please enter your full name:" }),
        positionX: 300,
        positionY: 100,
      },
    }),
    prisma.flowNode.create({
      data: {
        flowId: flow.id,
        nodeKey: "collect_interest",
        nodeType: "collect_input",
        config: JSON.stringify({ varName: "interest", options: ["Sales", "Support", "Marketing"], prompt: "What are you most interested in?" }),
        positionX: 500,
        positionY: 100,
      },
    }),
    prisma.flowNode.create({
      data: {
        flowId: flow.id,
        nodeKey: "handoff",
        nodeType: "handoff",
        config: JSON.stringify({ message: "Thanks {{name}}! A team member will reach out about {{interest}} shortly." }),
        positionX: 700,
        positionY: 100,
      },
    }),
  ]);

  await prisma.flow.update({
    where: { id: flow.id },
    data: { entryNodeId: node1.id },
  });
  console.log(`Created flow "${flow.name}" with ${4} nodes`);

  // ── Flow Runs ─────────────────────────────────────────────
  const flowConv = conversations[0];
  const [run1, run2] = await Promise.all([
    prisma.flowRun.create({
      data: {
        flowId: flow.id,
        userId: user.id,
        contactId: contacts[0].id,
        conversationId: flowConv.id,
        status: "active",
        currentNodeKey: "collect_interest",
        vars: JSON.stringify({ name: "Sarah" }),
        repromptCount: 0,
      },
    }),
    prisma.flowRun.create({
      data: {
        flowId: flow.id,
        userId: user.id,
        contactId: contacts[5].id,
        conversationId: conversations[5]?.id ?? flowConv.id,
        status: "completed",
        currentNodeKey: "handoff",
        vars: JSON.stringify({ name: "David", interest: "Support" }),
        repromptCount: 1,
        endedAt: new Date("2026-05-24"),
        endReason: "completed",
      },
    }),
  ]);

  // ── Flow Run Events ───────────────────────────────────────
  await prisma.flowRunEvent.createMany({
    data: [
      { flowRunId: run1.id, eventType: "node_entered", nodeKey: "welcome", payload: JSON.stringify({ timestamp: new Date().toISOString() }) },
      { flowRunId: run1.id, eventType: "node_entered", nodeKey: "collect_name", payload: JSON.stringify({ timestamp: new Date().toISOString() }) },
      { flowRunId: run2.id, eventType: "node_entered", nodeKey: "welcome", payload: JSON.stringify({}) },
      { flowRunId: run2.id, eventType: "node_entered", nodeKey: "collect_name", payload: JSON.stringify({}) },
      { flowRunId: run2.id, eventType: "node_entered", nodeKey: "collect_interest", payload: JSON.stringify({}) },
      { flowRunId: run2.id, eventType: "node_entered", nodeKey: "handoff", payload: JSON.stringify({}) },
    ],
  });
  console.log(`Created ${2} flow runs with events`);

  console.log("\n✅ Seed complete!");
  console.log("   superadmin@demo.com / password123  (superadmin)");
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
