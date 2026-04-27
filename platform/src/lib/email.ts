import nodemailer from "nodemailer";

type EmailPayload = {
  to: string;
  subject: string;
  text: string;
};

function createTransport() {
  const host = process.env.SMTP_HOST?.trim();
  const portRaw = process.env.SMTP_PORT?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!host || !portRaw || !user || !pass) return null;

  const port = Number(portRaw);
  if (!Number.isFinite(port)) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendEmail(payload: EmailPayload) {
  const from = process.env.SMTP_FROM?.trim();
  const transport = createTransport();
  if (!transport || !from) {
    console.warn("Email not sent. Missing SMTP config.", {
      to: payload.to,
      subject: payload.subject,
      preview: payload.text,
    });
    return false;
  }

  await transport.sendMail({
    from,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
  });
  return true;
}
