"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr((j as { error?: string }).error || "Login failed");
      return;
    }
    if ((j as { role?: string }).role === "HR") {
      router.push("/dashboard/hr/commissions");
    } else {
      router.push("/dashboard");
    }
    router.refresh();
  }

  return (
    <main style={{ maxWidth: 420, margin: "4rem auto", padding: "0 1rem" }}>
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Elevated Job Operations</h1>
        <p style={{ color: "var(--muted)" }}>Sign in with your role account.</p>
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
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Password</span>
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
          {err && <p style={{ color: "#f87171", margin: 0 }}>{err}</p>}
          <button className="btn" type="submit">
            Sign in
          </button>
          <Link href="/forgot-password" style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
            Forgot password?
          </Link>
        </form>
      </div>
    </main>
  );
}
