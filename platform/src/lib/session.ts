import { cookies } from "next/headers";
import { Role } from "@prisma/client";
import { prisma } from "./db";
import { cookieName, verifyToken, type TokenPayload } from "./auth";
import type { SessionUser } from "./rbac";

export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(cookieName())?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, role: true, salespersonId: true },
  });
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    role: user.role as Role,
    salespersonId: user.salespersonId,
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
