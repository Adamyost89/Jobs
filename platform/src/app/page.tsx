import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function Home() {
  const s = await getSession();
  if (s) redirect("/dashboard");
  redirect("/login");
}
