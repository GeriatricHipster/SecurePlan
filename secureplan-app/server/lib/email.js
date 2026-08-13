import nodemailer from 'nodemailer';

let cachedToken = null;
let cachedTokenExpiresAt = 0;
let cachedGmailTransporter = null;
let cachedGmailKey = null;

async function getGraphAccessToken(config) {
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 30_000) return cachedToken;
  const tokenUrl = `https://login.microsoftonline.com/${config.azureTenantId}/oauth2/v2.0/token`;
  const response = await fetch(tokenUrl, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.azureClientId,
      client_secret: config.azureClientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to get Microsoft Graph access token (${response.status}): ${body.slice(0, 300)}`);
  }
  const data = await response.json();
  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  return cachedToken;
}

function isGraphConfigured(config) {
  return Boolean(config.azureTenantId && config.azureClientId && config.azureClientSecret && config.emailFromMailbox);
}

function isResendConfigured(config) {
  return Boolean(config.resendApiKey);
}

function isGmailConfigured(config) {
  return Boolean(config.gmailUser && config.gmailAppPassword);
}

async function sendViaGraph(config, { to, subject, html, attachments }) {
  const accessToken = await getGraphAccessToken(config);
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.emailFromMailbox)}/sendMail`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: html },
          toRecipients: [{ emailAddress: { address: to } }],
          attachments: (attachments || []).map((attachment) => ({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: attachment.filename,
            contentType: attachment.contentType,
            contentBytes: attachment.buffer.toString('base64'),
          })),
        },
        saveToSentItems: false,
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Email send failed via Microsoft Graph (${response.status}): ${body.slice(0, 300)}`);
  }
  return { sent: true, provider: 'graph' };
}

async function sendViaResend(config, { to, subject, html, text, attachments }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.resendFrom || 'SecurePlan Surveyor <onboarding@resend.dev>',
      to,
      subject,
      html,
      text,
      attachments: (attachments || []).map((attachment) => ({
        filename: attachment.filename,
        content: attachment.buffer.toString('base64'),
      })),
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Email send failed via Resend (${response.status}): ${body.slice(0, 300)}`);
  }
  return { sent: true, provider: 'resend' };
}

function getGmailTransporter(config) {
  const key = `${config.gmailUser}\n${config.gmailAppPassword}`;
  if (cachedGmailTransporter && cachedGmailKey === key) return cachedGmailTransporter;
  cachedGmailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: config.gmailUser, pass: config.gmailAppPassword },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });
  cachedGmailKey = key;
  return cachedGmailTransporter;
}

async function sendViaGmail(config, { to, subject, html, text, attachments }) {
  const transporter = getGmailTransporter(config);
  try {
    await transporter.sendMail({
      from: `"SecurePlan Surveyor" <${config.gmailUser}>`,
      to,
      subject,
      html,
      text,
      attachments: (attachments || []).map((attachment) => ({
        filename: attachment.filename,
        content: attachment.buffer,
        contentType: attachment.contentType,
      })),
    });
    return { sent: true, provider: 'gmail' };
  } catch (error) {
    throw new Error(`Email send failed via Gmail: ${error.message || error.code || 'unknown error'}`);
  }
}

export async function sendEmail(config, { to, subject, html, text, attachments }) {
  // Prefer Microsoft Graph (the university's own M365 tenant) whenever it's configured.
  // Gmail SMTP is a reliable free option that works without a verified domain, and can send
  // to anyone (unlike Resend's test domain, which can only send to the account owner).
  // Resend is the last-resort fallback. Whichever is configured is used automatically -
  // switching providers later needs no code changes, just environment variables.
  if (isGraphConfigured(config)) return sendViaGraph(config, { to, subject, html, attachments });
  if (isGmailConfigured(config)) return sendViaGmail(config, { to, subject, html, text, attachments });
  if (isResendConfigured(config)) return sendViaResend(config, { to, subject, html, text, attachments });
  console.warn(`No email provider is configured (Graph, Gmail, or Resend); skipping email to ${to} ("${subject}").`);
  return { skipped: true };
}

function emailShell(title, bodyHtml) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#eef1f2;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f2;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;">
          <tr><td style="background:#b4232d;padding:20px 28px;">
            <span style="color:#ffffff;font-size:18px;font-weight:800;">SecurePlan Surveyor</span>
          </td></tr>
          <tr><td style="padding:28px;color:#1c272e;font-size:15px;line-height:1.55;">
            <h1 style="margin:0 0 14px;font-size:19px;color:#1c272e;">${title}</h1>
            ${bodyHtml}
          </td></tr>
          <tr><td style="padding:16px 28px;border-top:1px solid #e5e8ea;color:#748089;font-size:12px;">
            If you weren't expecting this email, you can safely ignore it.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function inviteEmailTemplate({ inviterName, code, roleLabel, siteName, appUrl }) {
  const html = emailShell('You\u2019ve been invited', `
    <p>${inviterName} invited you to join ${siteName ? `<strong>${siteName}</strong> on ` : ''}SecurePlan Surveyor as a <strong>${roleLabel}</strong>.</p>
    <p>Your invitation code:</p>
    <p style="font-size:24px;font-weight:800;letter-spacing:2px;background:#f4f5f6;border-radius:8px;padding:14px 18px;text-align:center;">${code}</p>
    <p>Go to <a href="${appUrl}" style="color:#b4232d;">${appUrl}</a> and enter this code to create your account.</p>
  `);
  return {
    subject: 'You\u2019re invited to SecurePlan Surveyor',
    html,
    text: `${inviterName} invited you to join SecurePlan Surveyor as a ${roleLabel}. Your invitation code: ${code}. Go to ${appUrl} to create your account.`,
  };
}

export function passwordResetEmailTemplate({ resetUrl }) {
  const html = emailShell('Reset your password', `
    <p>We received a request to reset your SecurePlan Surveyor password.</p>
    <p style="text-align:center;margin:24px 0;">
      <a href="${resetUrl}" style="display:inline-block;background:#b4232d;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;">Reset password</a>
    </p>
    <p>This link expires in 1 hour. If the button doesn't work, copy this link:</p>
    <p style="word-break:break-all;color:#748089;font-size:13px;">${resetUrl}</p>
  `);
  return {
    subject: 'Reset your SecurePlan password',
    html,
    text: `Reset your SecurePlan Surveyor password: ${resetUrl} (expires in 1 hour)`,
  };
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function textToHtmlParagraphs(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => `<p style="margin:0 0 10px;">${escapeHtml(line)}</p>`)
    .join('');
}

export function surveyReportEmailTemplate({ senderName, title, bodyText, surveyName, surveyUrl, photoCount = 0 }) {
  const html = emailShell(escapeHtml(title) || 'Field report', `
    <p style="color:#748089;font-size:13px;">${senderName || 'A teammate'} shared a report from <strong>${surveyName || 'a survey'}</strong>.</p>
    <div style="background:#f4f5f6;border-radius:8px;padding:16px 18px;margin:16px 0;">${textToHtmlParagraphs(bodyText)}</div>
    ${photoCount > 0 ? `<p style="color:#748089;font-size:13px;">${photoCount} photo${photoCount === 1 ? '' : 's'} attached.</p>` : ''}
    <p style="text-align:center;margin:24px 0;">
      <a href="${surveyUrl}" style="display:inline-block;background:#b4232d;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;">Open survey</a>
    </p>
  `);
  return {
    subject: `${title || 'Field report'} — ${surveyName || 'SecurePlan Surveyor'}`,
    html,
    text: `${senderName || 'A teammate'} shared a report from ${surveyName || 'a survey'}.\n\n${bodyText}${photoCount > 0 ? `\n\n(${photoCount} photo${photoCount === 1 ? '' : 's'} attached.)` : ''}\n\nOpen the survey: ${surveyUrl}`,
  };
}

export function elementUpdateEmailTemplate({ senderName, elementLabel, surveyName, message, surveyUrl, photoCount = 0 }) {
  const html = emailShell('An update was flagged for you', `
    <p><strong>${senderName || 'A teammate'}</strong> flagged an update on <strong>${elementLabel || 'a device'}</strong> in <strong>${surveyName || 'a survey'}</strong>.</p>
    ${message ? `<p style="background:#f4f5f6;border-radius:8px;padding:14px 16px;margin:16px 0;">${message}</p>` : ''}
    ${photoCount > 0 ? `<p style="color:#748089;font-size:13px;">${photoCount} photo${photoCount === 1 ? '' : 's'} attached.</p>` : ''}
    <p style="text-align:center;margin:24px 0;">
      <a href="${surveyUrl}" style="display:inline-block;background:#b4232d;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;">Open survey</a>
    </p>
  `);
  return {
    subject: `${senderName || 'A teammate'} flagged an update in ${surveyName || 'a survey'}`,
    html,
    text: `${senderName || 'A teammate'} flagged an update on ${elementLabel || 'a device'} in ${surveyName || 'a survey'}.${message ? ` Note: ${message}` : ''}${photoCount > 0 ? ` (${photoCount} photo${photoCount === 1 ? '' : 's'} attached.)` : ''} Open the survey: ${surveyUrl}`,
  };
}
