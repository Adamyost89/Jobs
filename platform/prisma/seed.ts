import { Prisma, PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { defaultCommissionPlanConfig } from "../src/lib/commission-plan-defaults";

const prisma = new PrismaClient();

async function main() {
  await prisma.systemConfig.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", cutoverComplete: false },
    update: {},
  });

  const names = [
    "Brett",
    "Drew",
    "James",
    "Mike",
    "Geoff",
    "Will",
    "Adam",
  ];
  for (const name of names) {
    await prisma.salesperson.upsert({
      where: { name },
      create: { name, active: true, kind: name === "Drew" ? "MANAGER" : "REP" },
      update: { active: true },
    });
  }
  await prisma.salesperson.updateMany({
    where: { name: "Drew" },
    data: { kind: "MANAGER" },
  });

  for (const year of [2024, 2025, 2026]) {
    const cfg = defaultCommissionPlanConfig(year);
    if (Object.keys(cfg.people).length === 0) continue;
    await prisma.commissionPlan.upsert({
      where: { year },
      create: { year, config: cfg as unknown as Prisma.InputJsonValue },
      update: { config: cfg as unknown as Prisma.InputJsonValue },
    });
  }

  const email =
    process.env.SEED_SUPERADMIN_EMAIL || "superadmin@example.com";
  const plain =
    process.env.SEED_SUPERADMIN_PASSWORD || "ChangeMe123!";
  const passwordHash = await bcrypt.hash(plain, 12);

  await prisma.user.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      role: Role.SUPER_ADMIN,
    },
    update: { passwordHash, role: Role.SUPER_ADMIN },
  });

  const adminEmail = "admin@example.com";
  await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      passwordHash: await bcrypt.hash("AdminChangeMe123!", 12),
      role: Role.ADMIN,
    },
    update: { role: Role.ADMIN },
  });

  const hrEmail = process.env.SEED_HR_EMAIL || "hr@example.com";
  const hrPassword = process.env.SEED_HR_PASSWORD || "HrChangeMe123!";
  await prisma.user.upsert({
    where: { email: hrEmail },
    create: {
      email: hrEmail,
      passwordHash: await bcrypt.hash(hrPassword, 12),
      role: Role.HR,
    },
    update: { role: Role.HR, passwordHash: await bcrypt.hash(hrPassword, 12) },
  });

  const brett = await prisma.salesperson.findUniqueOrThrow({
    where: { name: "Brett" },
  });
  await prisma.user.upsert({
    where: { email: "brett@example.com" },
    create: {
      email: "brett@example.com",
      passwordHash: await bcrypt.hash("SalesChangeMe123!", 12),
      role: Role.SALESMAN,
      salespersonId: brett.id,
    },
    update: {
      role: Role.SALESMAN,
      salespersonId: brett.id,
    },
  });

  console.log("Seed OK. Super admin:", email, "/ password from env or default");
  console.log("HR user:", hrEmail, "(password from SEED_HR_PASSWORD or default)");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
