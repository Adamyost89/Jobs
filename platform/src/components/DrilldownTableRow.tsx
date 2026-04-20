"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";

/** Table row that navigates to a drill-down URL (e.g. filtered Jobs list). */
export function DrilldownTableRow({
  href,
  children,
  disabled,
}: {
  href: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  const router = useRouter();
  const go = () => {
    if (!disabled) void router.push(href);
  };
  return (
    <tr
      className={disabled ? undefined : "table-row-drill"}
      tabIndex={disabled ? undefined : 0}
      role={disabled ? undefined : "link"}
      aria-label={disabled ? undefined : "Open matching jobs in Jobs list"}
      onClick={(e: PointerEvent<HTMLTableRowElement>) => {
        if (disabled) return;
        const t = e.target as HTMLElement | null;
        if (t?.closest("a, button, input, select, textarea, [role='switch']")) return;
        go();
      }}
      onKeyDown={(e: KeyboardEvent<HTMLTableRowElement>) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      }}
    >
      {children}
    </tr>
  );
}
