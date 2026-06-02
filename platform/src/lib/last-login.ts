import { prisma } from "./db";

/** Avoid writing on every server render while a session stays active. */
const TOUCH_INTERVAL_MS = 30 * 60 * 1000;

export function shouldTouchLastLogin(lastLoginAt: Date | null | undefined): boolean {
  if (!lastLoginAt) return true;
  return Date.now() - lastLoginAt.getTime() >= TOUCH_INTERVAL_MS;
}

export async function touchLastLogin(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
  });
}
