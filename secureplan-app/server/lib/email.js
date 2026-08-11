let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getGraphAccessToken(config) {
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 30_000) return cachedToken;
  const tokenUrl = `https://login.microsoftonline.com/${config.azureTenantId}/oauth2/v2.0/token`;
  const response = await fetch(tokenUrl, {
    method: 'POST',
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

export async function sendEmail(config, { to, subject, html, text }) {
  if (!config.azureTenantId || !config.azureClientId || !config.azureClientSecret || !config.emailFromMailbox) {
    console.warn(`Microsoft Graph email is not configured; skipping email to ${to} ("${subject}").`);
    return { skipped: true };
  }
  const accessToken = await getGraphAccessToken(config);
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.emailFromMailbox)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: html },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: false,
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Email send failed (${response.status}): ${body.slice(0, 300)}`);
  }
  return { sent: true };
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
