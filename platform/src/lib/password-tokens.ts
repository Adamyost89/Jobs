import { createHash, randomBytes } from "crypto";
import { PasswordTokenType } from "@prisma/client";
import { prisma } from "@/lib/db";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function issuePasswordToken(userId: string, type: PasswordTokenType) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);

  await prisma.passwordToken.create({
    data: { userId, tokenHash, type, expiresAt },
  });
  return token;
}

export async function consumePasswordToken(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const existing = await prisma.passwordToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!existing) return null;
  if (existing.usedAt) return null;
  if (existing.expiresAt.getTime() < Date.now()) return null;

  await prisma.passwordToken.update({
    where: { id: existing.id },
    data: { usedAt: new Date() },
  });

  return existing;
}
