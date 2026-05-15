'use strict';

/*
 * Mailer — Phase 105.
 *
 * Thin nodemailer wrapper. In demo mode (no SMTP_HOST env var) it logs
 * the would-be email to the console instead of sending it, so the runner
 * works out-of-the-box without any mail configuration.
 *
 * To wire real delivery set:
 *   SMTP_HOST     smtp.example.com
 *   SMTP_PORT     587                 (defaults to 587)
 *   SMTP_USER     user@example.com
 *   SMTP_PASS     secret
 *   SMTP_FROM     "AXIS Reports" <reports@axis-command.com>
 *
 * Everything else (TLS, auth) is standard nodemailer defaults.
 */

const nodemailer = require('nodemailer');

const DEMO = !process.env.SMTP_HOST;

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

/**
 * sendReport({ to[], subject, text, pdfBuffer, filename })
 *
 * In demo mode: logs to stdout, returns { demo: true }.
 * In live mode: sends via SMTP, returns nodemailer info object.
 */
async function sendReport({ to, subject, text, pdfBuffer, filename }) {
  if (DEMO) {
    console.log('[mailer] DEMO — would send:');
    console.log(`  To      : ${to.join(', ')}`);
    console.log(`  Subject : ${subject}`);
    console.log(`  PDF     : ${filename} (${pdfBuffer.length} bytes)`);
    return { demo: true, accepted: to };
  }

  const from = process.env.SMTP_FROM || '"AXIS Reports" <reports@axis-command.com>';
  const info = await transport().sendMail({
    from,
    to:      to.join(', '),
    subject,
    text,
    attachments: [
      {
        filename,
        content:     pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
  return info;
}

module.exports = { sendReport, DEMO };
