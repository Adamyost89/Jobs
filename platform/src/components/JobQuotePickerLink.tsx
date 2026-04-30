"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import type { JobQuoteLinkOption } from "@/lib/job-quote-links";

function labelForQuote(quote: JobQuoteLinkOption, index: number): string {
  if (quote.quoteName?.trim()) return quote.quoteName.trim();
  return `Quote ${index + 1}`;
}

function dateLabel(iso: string | null): string | null {
  if (!iso) return null;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString();
}

export function JobQuotePickerLink({
  fallbackHref,
  fallbackLabel,
  quoteLinks,
  style,
  className,
}: {
  fallbackHref: string;
  fallbackLabel: string;
  quoteLinks?: JobQuoteLinkOption[] | null;
  style?: CSSProperties;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const links = quoteLinks ?? [];
  const title = useMemo(() => `Select quote for job ${fallbackLabel}`, [fallbackLabel]);

  if (links.length === 0) {
    return (
      <Link href={fallbackHref} className={className} style={style}>
        {fallbackLabel}
      </Link>
    );
  }
  if (links.length === 1) {
    return (
      <a href={links[0]!.shareLink} target="_blank" rel="noreferrer" className={className} style={style}>
        {fallbackLabel}
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        className={className}
        style={{ ...style, background: "none", border: 0, padding: 0, cursor: "pointer" }}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        {fallbackLabel}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "grid",
            placeItems: "center",
            zIndex: 1500,
            padding: "1rem",
          }}
          onClick={() => setOpen(false)}
        >
          <div
            className="card"
            style={{ width: "min(560px, 100%)", display: "grid", gap: "0.7rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: 0, fontSize: "1rem" }}>{title}</h3>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "0.45rem" }}>
              {links.map((q, i) => (
                <li key={`${q.quoteId}|${q.shareLink}`}>
                  <a
                    href={q.shareLink}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "0.8rem",
                      textDecoration: "none",
                      padding: "0.5rem 0.65rem",
                      border: "1px solid var(--line)",
                      borderRadius: "0.5rem",
                      color: "inherit",
                    }}
                    onClick={() => setOpen(false)}
                  >
                    <span>{labelForQuote(q, i)}</span>
                    <span style={{ color: "var(--muted)", fontSize: "0.82rem" }}>{dateLabel(q.approvedDate) ?? "—"}</span>
                  </a>
                </li>
              ))}
            </ul>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="btn secondary" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
