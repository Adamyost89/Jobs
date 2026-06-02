import Link from "next/link";

export function FormsNavTabs({
  active,
}: {
  active: "pending" | "submitted" | "analytics";
}) {
  return (
    <div className="card" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", padding: "0.75rem 1rem" }}>
      <Link
        href="/dashboard/forms"
        className={`btn${active === "pending" ? "" : " secondary"}`}
        style={{ textDecoration: "none" }}
        aria-current={active === "pending" ? "page" : undefined}
      >
        Pending
      </Link>
      <Link
        href="/dashboard/forms?view=submitted"
        className={`btn${active === "submitted" ? "" : " secondary"}`}
        style={{ textDecoration: "none" }}
        aria-current={active === "submitted" ? "page" : undefined}
      >
        Submitted
      </Link>
      <Link
        href="/dashboard/forms/analytics"
        className={`btn${active === "analytics" ? "" : " secondary"}`}
        style={{ textDecoration: "none" }}
        aria-current={active === "analytics" ? "page" : undefined}
      >
        Analytics
      </Link>
    </div>
  );
}
