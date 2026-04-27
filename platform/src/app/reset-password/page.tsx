"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import { useState } from "react";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!token) {
      setError("Missing reset token");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setBusy(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError((j as { error?: string }).error ?? "Unable to reset password");
      return;
    }
    setMessage("Password updated. Redirecting to sign in...");
    setTimeout(() => router.push("/login"), 1000);
  }

  return (
    <main style={{ maxWidth: 420, margin: "4rem auto", padding: "0 1rem" }}>
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Set your password</h1>
        <p style={{ color: "var(--muted)" }}>Choose a new password for your account.</p>
        <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.75rem" }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>New password</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
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
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Confirm password</span>
            <input
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              type="password"
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
            Save password
          </button>
          <Link href="/login" style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
            Back to sign in
          </Link>
        </form>
      </div>
    </main>
  );
}
