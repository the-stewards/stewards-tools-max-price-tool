// Fires on every Netlify Forms submission on this site (currently one form,
// "lead-capture"). Netlify's built-in email notification has a fixed,
// non-customizable subject line — this replaces it with a real, controllable
// send via Resend so the subject/body can say whatever we want.

const RESEND_API_URL = 'https://api.resend.com/emails';
const TEAM_EMAIL = process.env.TEAM_EMAIL ?? 'stewards@ruoff.com';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'team@stewards.loan';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatMoney(n) {
  const num = Number(n);
  return Number.isFinite(num) ? '$' + Math.round(num).toLocaleString('en-US') : esc(n);
}

function row(label, value) {
  if (value === undefined || value === null || value === '') return '';
  return `<tr><td style="padding:.4rem 0;color:#7a7474;width:170px">${esc(label)}</td><td style="padding:.4rem 0">${value}</td></tr>`;
}

export default async (req) => {
  let payload;
  try {
    const body = await req.json();
    payload = body.payload;
  } catch {
    return new Response('Invalid payload', { status: 400 });
  }

  const data = payload?.data ?? {};
  const formName = payload?.form_name ?? 'unknown';

  const html = `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#fffae8;padding:2rem">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;padding:2rem;border:1px solid #ddd5be">
    <div style="font-family:'Arial Black',sans-serif;font-size:1.5rem;color:#f76732;letter-spacing:.08em;margin-bottom:1rem">NEW STEWARD TOOL LEAD</div>
    <table style="width:100%;border-collapse:collapse;font-size:.9rem">
      ${row('Tool', esc(formName))}
      ${row('Email', esc(data.email))}
      ${row('Mode', esc(data.mode))}
      ${row('Estimated Price', data.estimated_price ? `<b>${formatMoney(data.estimated_price)}</b>` : '')}
      ${row('Monthly P&amp;I', data.monthly_pi ? formatMoney(data.monthly_pi) : '')}
      ${row('Monthly Tax', data.monthly_tax ? formatMoney(data.monthly_tax) : '')}
      ${row('Monthly Insurance', data.monthly_insurance ? formatMoney(data.monthly_insurance) : '')}
      ${Number(data.monthly_pmi) > 0 ? row('Monthly PMI', formatMoney(data.monthly_pmi)) : ''}
      ${row('Total Monthly Payment', data.total_monthly_payment ? `<b>${formatMoney(data.total_monthly_payment)}</b>` : '')}
      ${row('Page', data.page_url ? `<a href="${esc(data.page_url)}">${esc(data.page_url)}</a>` : '')}
      ${row('Submitted', new Date(payload?.created_at ?? Date.now()).toLocaleString('en-US', { timeZone: 'America/New_York' }))}
    </table>
  </div>
</body></html>`;

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `The Stewards Tools <${FROM_EMAIL}>`,
        to: [TEAM_EMAIL],
        subject: 'New Steward Tool Lead',
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[submission-created] Resend send failed:', err.message ?? res.status);
    }
  } catch (err) {
    console.error('[submission-created] Resend request failed:', err.message);
  }

  // Netlify doesn't act on the response, but return 200 so this doesn't show
  // up as a failed invocation in the function logs.
  return new Response('ok', { status: 200 });
};
