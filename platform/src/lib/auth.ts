import { SignJWT, jwtVerify } from "jose";
import { Role } from "@prisma/client";

const COOKIE = "elevated_session";

export function cookieName() {
  return COOKIE;
}

function secretKey() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(s);
}

export type TokenPayload = {
  sub: string;
  email: string;
  role: Role;
  sp?: string | null;
};

export async function signToken(payload: TokenPayload, maxAgeSec = 60 * 60 * 24 * 7) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSec}s`)
    .sign(secretKey());
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return {
      sub: String(payload.sub),
      email: String(payload.email),
      role: payload.role as Role,
      sp: (payload.sp as string | null | undefined) ?? null,
    };
  } catch {
    return null;
  }
}
