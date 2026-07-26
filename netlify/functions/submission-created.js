// Fires on every Netlify Forms submission on this site (currently one form,
// "lead-capture"). Sends two emails per submission:
//   1. Team notification to TEAM_EMAIL — internal heads-up, no Ledger write.
//   2. Consumer confirmation to the visitor's own address — the thing the
//      "Email Me This" button actually promises. Netlify's built-in Forms
//      notification can't do either of these (fixed subject, single
//      recipient), so both are sent directly via Resend.

const RESEND_API_URL = 'https://api.resend.com/emails';
const TEAM_EMAIL = process.env.TEAM_EMAIL ?? 'stewards@ruoff.com';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'team@stewards.loan';

// Same disclaimer already live on the widget page — reused verbatim so the
// email never says anything about loan terms the page hasn't already said.
const LEGAL_DISCLAIMER = "This calculator provides a general estimate based only on the figures you entered and does not constitute a loan approval, pre-qualification, offer of credit, or commitment to lend. It does not represent specific loan terms available to you or advertised by Ruoff Mortgage. Actual purchasing power depends on credit history, property taxes, insurance costs, PMI, program guidelines, and full underwriting review. Ryan Miracle, Senior Loan Officer, NMLS #497698. Chris Beal, Loan Officer, NMLS #514071. Ruoff Mortgage, 8101 N High St Suite 300, Columbus OH 43235, NMLS #141868. Equal Housing Opportunity.";

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

async function sendResendEmail({ to, subject, html }) {
  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `The Stewards <${FROM_EMAIL}>`,
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }
}

function buildTeamEmail(data, formName, createdAt) {
  return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#fffae8;padding:2rem">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;padding:2rem;border:1px solid #ddd5be">
    <div style="font-family:'Arial Black',sans-serif;font-size:1.5rem;color:#f76732;letter-spacing:.08em;margin-bottom:1rem">NEW STEWARD TOOL LEAD</div>
    <table style="width:100%;border-collapse:collapse;font-size:.9rem">
      ${row('Tool', esc(formName))}
      ${row('Email', esc(data.email))}
      ${row('Mode', esc(data.mode))}
      ${row('Estimated Price', data.estimated_price ? `<b>${formatMoney(data.estimated_price)}</b>` : '')}
      ${row('Down Payment', data.down_payment ? formatMoney(data.down_payment) : '')}
      ${row('Rate', data.rate ? `${esc(data.rate)}%` : '')}
      ${row('Monthly P&amp;I', data.monthly_pi ? formatMoney(data.monthly_pi) : '')}
      ${row('Monthly Tax', data.monthly_tax ? formatMoney(data.monthly_tax) : '')}
      ${row('Monthly Insurance', data.monthly_insurance ? formatMoney(data.monthly_insurance) : '')}
      ${Number(data.monthly_pmi) > 0 ? row('Monthly PMI', formatMoney(data.monthly_pmi)) : ''}
      ${row('Total Monthly Payment', data.total_monthly_payment ? `<b>${formatMoney(data.total_monthly_payment)}</b>` : '')}
      ${row('Page', data.page_url ? `<a href="${esc(data.page_url)}">${esc(data.page_url)}</a>` : '')}
      ${row('Submitted', createdAt)}
    </table>
  </div>
</body></html>`;
}

function buildConsumerEmail(data) {
  const loanAmount = Math.max(Number(data.estimated_price ?? 0) - Number(data.down_payment ?? 0), 0);
  const contextLine = data.total_monthly_payment && data.rate
    ? `Based on an estimated ${formatMoney(data.total_monthly_payment)}/mo payment and a ${esc(data.rate)}% rate.`
    : '';

  const pmiRow = Number(data.monthly_pmi) > 0
    ? `<tr><td style="padding:.4rem 0;color:#7a7474">Est. Monthly PMI</td><td style="padding:.4rem 0">${formatMoney(data.monthly_pmi)}</td></tr>`
    : '';

  return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#fffae8;padding:2rem">
  <div style="max-width:520px;margin:0 auto;background:#403d3d;border-left:4px solid #f76732;border-radius:0 8px 8px 0;padding:2rem;text-align:center">
    <div style="font-family:Arial,sans-serif;font-weight:bold;font-size:.85rem;letter-spacing:.3em;text-transform:uppercase;color:#f76732;margin-bottom:.5rem">Your Estimated Range</div>
    <div style="font-family:'Arial Black',sans-serif;font-size:2.5rem;color:#f76732;margin-bottom:1rem;line-height:1">${formatMoney(data.estimated_price)}</div>
    <div style="font-size:.9rem;color:rgba(255,250,232,0.75);line-height:1.6;margin-bottom:.5rem">${contextLine}</div>
    <div style="font-size:.8rem;color:rgba(255,250,232,0.5);line-height:1.6;margin-bottom:1.5rem">Not an offer of credit or specific loan terms — based only on what you entered.</div>
    <table style="width:100%;border-collapse:collapse;font-size:.85rem;color:rgba(255,250,232,0.85);text-align:left;border-top:1px solid rgba(255,250,232,0.2);padding-top:1rem;margin-top:1rem">
      <tr><td style="padding:.4rem 0;">Estimated Loan Amount</td><td style="padding:.4rem 0;text-align:right;color:#fffae8;">${formatMoney(loanAmount)}</td></tr>
      <tr><td style="padding:.4rem 0;">Est. Monthly Principal &amp; Interest</td><td style="padding:.4rem 0;text-align:right;color:#fffae8;">${formatMoney(data.monthly_pi)}</td></tr>
      <tr><td style="padding:.4rem 0;">Est. Monthly Property Tax</td><td style="padding:.4rem 0;text-align:right;color:#fffae8;">${formatMoney(data.monthly_tax)}</td></tr>
      <tr><td style="padding:.4rem 0;">Est. Monthly Insurance</td><td style="padding:.4rem 0;text-align:right;color:#fffae8;">${formatMoney(data.monthly_insurance)}</td></tr>
      ${pmiRow}
      <tr><td style="padding:.4rem 0;font-weight:bold;">Est. Total Monthly Payment</td><td style="padding:.4rem 0;text-align:right;font-weight:bold;color:#fffae8;">${formatMoney(data.total_monthly_payment)}</td></tr>
    </table>
  </div>
  <div style="max-width:520px;margin:1.5rem auto 0 auto;text-align:center">
    <div style="font-family:Arial,sans-serif;font-weight:bold;font-size:1.1rem;color:#403d3d;margin-bottom:.75rem">Want This Number, Verified?</div>
    <div style="font-size:.9rem;color:#555;line-height:1.6;margin-bottom:1.25rem">A calculator gives you an estimate. A Steward gives you an actual number, backed by real underwriting — usually within a day.</div>
    <a href="tel:+16147675273" style="display:inline-block;background:#f76732;color:#fffae8;font-family:Arial,sans-serif;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;padding:.9rem 2rem;border-radius:2px;text-decoration:none;font-size:.9rem">Talk to a Steward</a>
  </div>
  <div style="max-width:520px;margin:1.5rem auto 0 auto;font-size:.75rem;color:#999;line-height:1.6">${esc(LEGAL_DISCLAIMER)}</div>
</body></html>`;
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
  const createdAt = new Date(payload?.created_at ?? Date.now()).toLocaleString('en-US', { timeZone: 'America/New_York' });

  const sends = [
    sendResendEmail({ to: TEAM_EMAIL, subject: 'New Steward Tool Lead', html: buildTeamEmail(data, formName, createdAt) }),
  ];

  if (data.email) {
    sends.push(sendResendEmail({ to: data.email, subject: 'Your Max Purchase Price Estimate', html: buildConsumerEmail(data) }));
  }

  const results = await Promise.allSettled(sends);
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[submission-created] send ${i === 0 ? 'team' : 'consumer'} failed:`, r.reason?.message ?? r.reason);
    }
  });

  // Netlify doesn't act on the response, but return 200 so this doesn't show
  // up as a failed invocation in the function logs.
  return new Response('ok', { status: 200 });
};
