"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function isActive(href: string, pathname: string): boolean {
  if (href === "/dashboard/commissions") {
    return pathname === "/dashboard/commissions" || pathname === "/dashboard/commissions/";
  }
  if (href === "/dashboard/commissions/payout-summary") {
    return pathname.startsWith("/dashboard/commissions/payout-summary");
  }
  if (href === "/dashboard/hr/commissions") {
    return pathname.startsWith("/dashboard/hr/commissions");
  }
  return pathname === href;
}

export function CommissionSubnav({ showPayroll }: { showPayroll: boolean }) {
  const pathname = usePathname() ?? "";
  const items: { href: string; label: string }[] = [
    { href: "/dashboard/commissions", label: "Commission lines" },
    { href: "/dashboard/commissions/payout-summary", label: "Payout Summary" },
  ];
  if (showPayroll) {
    items.push({ href: "/dashboard/hr/commissions", label: "Payroll log" });
  }

  return (
    <nav
      className="commission-subnav card"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.35rem",
        padding: "0.5rem 0.75rem",
        alignItems: "center",
      }}
    >
      {items.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={isActive(href, pathname) ? "commission-tab commission-tab--active" : "commission-tab"}
          style={{ textDecoration: "none" }}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
