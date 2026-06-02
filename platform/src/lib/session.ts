import { cookies } from "next/headers";
import { after } from "next/server";
import { Role } from "@prisma/client";
import { prisma } from "./db";
import { cookieName, verifyToken, type TokenPayload } from "./auth";
import { shouldTouchLastLogin, touchLastLogin } from "./last-login";
import type { SessionUser } from "./rbac";
import { displaySalespersonName } from "./salesperson-name";

export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(cookieName())?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, role: true, salespersonId: true, lastLoginAt: true },
  });
  if (!user) return null;
  if (shouldTouchLastLogin(user.lastLoginAt)) {
    after(() => touchLastLogin(user.id).catch(() => undefined));
  }
  let salespersonIds: string[] = [];
  if (user.salespersonId) {
    const self = await prisma.salesperson.findUnique({
      where: { id: user.salespersonId },
      select: { id: true, name: true },
    });
    if (self) {
      const display = displaySalespersonName(self.name).toLowerCase();
      const peers = await prisma.salesperson.findMany({
        select: { id: true, name: true },
      });
      salespersonIds = peers
        .filter((p) => displaySalespersonName(p.name).toLowerCase() === display)
        .map((p) => p.id);
    } else {
      salespersonIds = [user.salespersonId];
    }
  }
  return {
    id: user.id,
    email: user.email,
    role: user.role as Role,
    salespersonId: user.salespersonId,
    salespersonIds,
  };
}

export function tokenPayloadFromUser(user: {
  id: string;
  email: string;
  role: Role;
  salespersonId: string | null;
}): TokenPayload {
  return {
    sub: user.id,
    email: user.email,
    role: user.role,
    sp: user.salespersonId,
  };
}
