import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Role } from "@prisma/client";
import { DashboardTopNav, type NavItem } from "@/components/DashboardTopNav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  const isHr = user.role === Role.HR;
  const roleLabel = user.role === Role.SALESMAN ? "ACCOUNT MANAGER" : user.role;
  const links: NavItem[] = isHr
    ? [{ href: "/dashboard/hr/commissions", label: "Commission payroll" }]
    : [
        { href: "/dashboard", label: "Home" },
        { href: "/dashboard/jobs", label: "Jobs" },
        { href: "/dashboard/commissions", label: "Commissions" },
        { href: "/dashboard/advanced", label: "Advanced" },
      ];

  return (
    <div className="dash-shell">
      <DashboardTopNav links={links} email={user.email} roleLabel={roleLabel} />
      <main className="dash-main">{children}</main>
    </div>
  );
}
