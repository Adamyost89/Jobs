import { NextResponse } from "next/server";
import { z } from "zod";
import { PasswordTokenType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { issuePasswordToken } from "@/lib/password-tokens";
import { getAppBaseUrl } from "@/lib/app-url";
import { sendEmail } from "@/lib/email";

const bodySchema = z.object({
  email: z.string().email(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json({ ok: true });
  }

  const token = await issuePasswordToken(user.id, PasswordTokenType.RESET);
  const baseUrl = await getAppBaseUrl();
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to: email,
    subject: "Reset your Elevated Sheets password",
    text: `We received a request to reset your Elevated Sheets password.\n\nUse this link to choose a new password (valid for 24 hours):\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
  });

  return NextResponse.json({ ok: true });
}
