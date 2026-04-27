"use client";

import Link from "next/link";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError((j as { error?: string }).error ?? "Unable to send reset email");
      return;
    }
    setMessage("If that email exists, a password reset link has been sent.");
  }

  return (
    <main style={{ maxWidth: 420, margin: "4rem auto", padding: "0 1rem" }}>
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Reset password</h1>
        <p style={{ color: "var(--muted)" }}>Enter your email to receive a reset link.</p>
        <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.75rem" }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              style={{
                padding: "0.6rem",
                borderRadius: 8,
                border: "1px solid #334155",
                background: "#0f172a",
                color: "var(--text)",
              }}
            />
          </label>
          {error && <p style={{ color: "#f87171", margin: 0 }}>{error}</p>}
          {message && <p style={{ color: "var(--muted)", margin: 0 }}>{message}</p>}
          <button className="btn" type="submit" disabled={busy}>
            Send reset link
          </button>
          <Link href="/login" style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
            Back to sign in
          </Link>
        </form>
      </div>
    </main>
  );
}
