import { NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { getSession } from "@/lib/session";
import { runProlineApiDiagnose, type ProlineDiagnoseCustom } from "@/lib/proline-api-diagnose";

const bodySchema = z
  .object({
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    projectsPath: z.string().optional(),
    authStyle: z.enum(["bearer", "token", "x_api_key"]).optional(),
    pageLimit: z.string().optional(),
  })
  .optional();

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
  const custom: ProlineDiagnoseCustom | undefined =
    body && Object.values(body).some((v) => v !== undefined && String(v).trim() !== "")
      ? {
          apiKey: body.apiKey,
          baseUrl: body.baseUrl,
          projectsPath: body.projectsPath,
          authStyle: body.authStyle,
          pageLimit: body.pageLimit,
        }
      : undefined;

  const result = await runProlineApiDiagnose(custom);
  return NextResponse.json(result);
}
