import { NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { getSession } from "@/lib/session";
import { runBubbleDataTypeDiscovery } from "@/lib/proline-bubble-discover";

const bodySchema = z
  .object({
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    projectsPath: z.string().optional(),
    authStyle: z.enum(["bearer", "token", "x_api_key"]).optional(),
    pageLimit: z.string().optional(),
  })
  .optional();

/** Super Admin: try common Bubble `/api/1.1/obj/<typename>` paths to find project list. */
export async function POST(req: Request) {
  const user = await getSession();
  if (!user || user.role !== Role.SUPER_ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;
  const custom =
    body && Object.values(body).some((v) => v !== undefined && String(v).trim() !== "") ? body : undefined;

  const result = await runBubbleDataTypeDiscovery(custom);
  return NextResponse.json(result);
}
