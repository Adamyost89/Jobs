import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const COOKIE = "elevated_session";

export async function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/dashboard")) {
    return NextResponse.next();
  }
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  const secret = process.env.JWT_SECRET;
  if (!secret) return NextResponse.redirect(new URL("/login", req.url));
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    const role = String(payload.role ?? "");
    if (role === "HR") {
      const path = req.nextUrl.pathname;
      if (!path.startsWith("/dashboard/hr")) {
        return NextResponse.redirect(new URL("/dashboard/hr/commissions", req.url));
      }
    }
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/login", req.url));
  }
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
