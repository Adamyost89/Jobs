"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { LogoutButton } from "@/components/LogoutButton";

export type NavItem = { href: string; label: string };

function pathMatchesNavHref(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/dashboard/advanced") {
    return (
      pathname === "/dashboard/advanced" ||
      pathname.startsWith("/dashboard/reports") ||
      pathname.startsWith("/dashboard/archives") ||
      pathname.startsWith("/dashboard/data/excel") ||
      pathname.startsWith("/dashboard/settings")
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardTopNav({
  links,
  email,
  roleLabel,
}: {
  links: NavItem[];
  email: string;
  roleLabel: string;
}) {
  const pathname = usePathname() || "";
  const headerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const headerEl = headerRef.current;
    if (!headerEl) return;

    const setHeaderHeightVar = () => {
      const px = `${Math.ceil(headerEl.getBoundingClientRect().height)}px`;
      document.documentElement.style.setProperty("--dash-header-height", px);
    };

    setHeaderHeightVar();

    const ro = new ResizeObserver(() => setHeaderHeightVar());
    ro.observe(headerEl);
    window.addEventListener("resize", setHeaderHeightVar);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", setHeaderHeightVar);
      document.documentElement.style.removeProperty("--dash-header-height");
    };
  }, []);

  const activeHref =
    [...links]
      .filter((l) => pathMatchesNavHref(pathname, l.href))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;

  return (
    <header ref={headerRef} className="dash-header">
      <div className="dash-header__brand">Elevated</div>
      <nav className="dash-nav" aria-label="Main">
        {links.map((l) => {
          const active = activeHref === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`dash-nav__link${active ? " dash-nav__link--active" : ""}`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
      <div className="dash-header__user">
        <span className="dash-header__email" title={email}>
          {email}
        </span>
        <span className="dash-header__role">{roleLabel}</span>
        <LogoutButton />
      </div>
    </header>
  );
}
