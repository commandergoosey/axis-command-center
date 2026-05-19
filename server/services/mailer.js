'use strict';

/*
 * Mailer — Phase 105 / LP-5.
 *
 * Thin nodemailer wrapper. In demo mode (no SMTP_HOST env var) all emails
 * are logged to the console instead of being sent, so the runner works
 * out-of-the-box without any mail configuration.
 *
 * Environment variables:
 *   SMTP_HOST     smtp.example.com
 *   SMTP_PORT     587                       (defaults to 587)
 *   SMTP_USER     user@example.com
 *   SMTP_PASS     secret
 *   SMTP_FROM     "AXIS" <noreply@axis-command.com>
 *   APP_URL       https://app.axis-command.com   (used for reset/invite links)
 */

const nodemailer = require('nodemailer');

const DEMO    = !process.env.SMTP_HOST;
const APP_URL = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
const FROM    = process.env.SMTP_FROM || '"AXIS Command" <noreply@axis-command.com>';

let _transport = null;

function transport() {
  if (_transport) return _transport;
  if (DEMO) return null;
  _transport = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return _transport;
}

/* ── Generic send ────────────────────────────────────────────────── */

/**
 * send({ to (string or string[]), subject, text, html? })
 * In demo mode: logs to console, returns { demo: true }.
 * In live mode: sends via SMTP.
 */
async function send({ to, subject, text, html }) {
  const toArr = Array.isArray(to) ? to : [to];
  if (DEMO) {
    console.log('[mailer] DEMO — would send:');
    console.log(`  To      : ${toArr.join(', ')}`);
    console.log(`  Subject : ${subject}`);
    console.log(`  Text    : ${text.slice(0, 200)}…`);
    return { demo: true, accepted: toArr };
  }
  return transport().sendMail({ from: FROM, to: toArr.join(', '), subject, text, html });
}

/* ── Report delivery (PDF attachment) ───────────────────────────── */

/**
 * sendReport({ to[], subject, text, pdfBuffer, filename })
 * In demo mode: logs to stdout, returns { demo: true }.
 */
async function sendReport({ to, subject, text, pdfBuffer, filename }) {
  if (DEMO) {
    console.log('[mailer] DEMO — would send report:');
    console.log(`  To      : ${to.join(', ')}`);
    console.log(`  Subject : ${subject}`);
    console.log(`  PDF     : ${filename} (${pdfBuffer.length} bytes)`);
    return { demo: true, accepted: to };
  }
  return transport().sendMail({
    from: FROM,
    to:   to.join(', '),
    subject, text,
    attachments: [{ filename, content: pdfBuffer, contentType: 'application/pdf' }],
  });
}

/* ── Transactional: password reset ──────────────────────────────── */

/**
 * sendPasswordReset(user, resetToken)
 * Sends a "Reset your password" email with a one-time link.
 */
async function sendPasswordReset(user, resetToken) {
  const link    = `${APP_URL}/reset-password?token=${resetToken}`;
  const subject = 'Reset your AXIS password';
  const text    = [
    `Hi ${user.display_name},`,
    '',
    'Someone (probably you) requested a password reset for your AXIS Command Center account.',
    '',
    `Reset link: ${link}`,
    '',
    'This link expires in 1 hour. If you did not request a reset, you can safely ignore this email.',
    '',
    '— AXIS Command Center',
  ].join('\n');

  const html = htmlWrap(subject, `
    <p>Hi <strong>${esc(user.display_name)}</strong>,</p>
    <p>Someone (probably you) requested a password reset for your AXIS Command Center account.</p>
    <p style="margin:24px 0">
      <a href="${esc(link)}" style="${ctaStyle}">Reset password</a>
    </p>
    <p style="color:#888;font-size:13px">This link expires in 1 hour. If you did not request a reset, you can safely ignore this email.</p>
  `);

  if (DEMO) {
    console.log(`[mailer] DEMO — password reset for ${user.email}`);
    console.log(`  Link: ${link}`);
    return { demo: true };
  }
  return send({ to: user.email, subject, text, html });
}

/* ── Transactional: user invite ─────────────────────────────────── */

/**
 * sendInvite(user, resetToken)
 * Sent when an admin creates a new account. The token acts as a first-login
 * setup link — the user sets their own password without needing the
 * admin-issued temporary one.
 */
async function sendInvite(user, resetToken) {
  const link    = `${APP_URL}/reset-password?token=${resetToken}`;
  const subject = "You've been invited to AXIS Command Center";
  const roleLabel = {
    axis_admin:   'AXIS Admin',
    axis_ops:     'AXIS Operations',
    hauler_admin: 'Hauler Admin',
    lender:       'Lender',
  }[user.role] || user.role;

  const text = [
    `Hi ${user.display_name},`,
    '',
    `You've been given access to AXIS Command Center (${APP_URL}) as ${roleLabel}.`,
    '',
    'Set your password using the link below — it expires in 1 hour:',
    '',
    link,
    '',
    'If you have any questions, contact your AXIS administrator.',
    '',
    '— AXIS Command Center',
  ].join('\n');

  const html = htmlWrap('Welcome to AXIS Command Center', `
    <p>Hi <strong>${esc(user.display_name)}</strong>,</p>
    <p>You've been given access to <a href="${esc(APP_URL)}">${esc(APP_URL)}</a> as <strong>${esc(roleLabel)}</strong>.</p>
    <p>Set your password using the link below — it expires in 1 hour.</p>
    <p style="margin:24px 0">
      <a href="${esc(link)}" style="${ctaStyle}">Set your password</a>
    </p>
    <p style="color:#888;font-size:13px">If you have any questions, contact your AXIS administrator.</p>
  `);

  if (DEMO) {
    console.log(`[mailer] DEMO — invite for ${user.email} (${roleLabel})`);
    console.log(`  Link: ${link}`);
    return { demo: true };
  }
  return send({ to: user.email, subject, text, html });
}

/* ── HTML template helpers ───────────────────────────────────────── */

const ctaStyle = [
  'display:inline-block',
  'padding:10px 20px',
  'background:#8b2e1a',
  'color:#f5f0eb',
  'text-decoration:none',
  'border-radius:4px',
  'font-family:sans-serif',
  'font-size:14px',
  'font-weight:600',
].join(';');

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function htmlWrap(title, body) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f5f0eb;font-family:sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0"
        style="background:#fff;border-radius:6px;border:1px solid #e0d9d0;overflow:hidden">
        <tr>
          <td style="background:#1f1f1f;padding:20px 32px">
            <span style="color:#f5f0eb;font-size:14px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase">
              AXIS COMMAND CENTER
            </span>
          </td>
        </tr>
        <tr><td style="padding:32px;color:#1f1f1f;font-size:15px;line-height:1.6">
          ${body}
        </td></tr>
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #e0d9d0;color:#aaa;font-size:12px">
            Nyinahin · Takoradi · 300 km — AXIS Command Center
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

module.exports = { send, sendReport, sendPasswordReset, sendInvite, DEMO, APP_URL };
