// Fires on EVERY Netlify Forms submission for this whole site — Netlify's
// submission-created auto-invocation is site-wide by exact filename, not
// per-form. A function named anything else (e.g. refi-lead-notify.js) will
// never be triggered by a real form submission, only by calling its URL
// directly. Discovered the hard way building the refi tool: the direct-curl
// test to refi-lead-notify worked, but a real form submit on that page was
// actually processed by THIS function instead, sending the wrong (max-
// purchase-price) template. Every form's email logic must live here,
// dispatched by payload.form_name.

const RESEND_API_URL = 'https://api.resend.com/emails';

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

async function sendResendEmail({ from, to, subject, html }) {
  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }
}

// ─── max-purchase-price.html ("lead-capture" form) ────────────────────────

const MPP_TEAM_EMAIL = process.env.TEAM_EMAIL ?? 'stewards@ruoff.com';
const MPP_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'team@stewards.loan';

// Same disclaimer already live on the widget page — reused verbatim so the
// email never says anything about loan terms the page hasn't already said.
const MPP_LEGAL_DISCLAIMER = "This calculator provides a general estimate based only on the figures you entered and does not constitute a loan approval, pre-qualification, offer of credit, or commitment to lend. It does not represent specific loan terms available to you or advertised by Ruoff Mortgage. Actual purchasing power depends on credit history, property taxes, insurance costs, PMI, program guidelines, and full underwriting review. Ryan Miracle, Senior Loan Officer, NMLS #497698. Chris Beal, Loan Officer, NMLS #514071. Ruoff Mortgage, 8101 N High St Suite 300, Columbus OH 43235, NMLS #141868. Equal Housing Opportunity.";

function buildMppTeamEmail(data, formName, createdAt) {
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

function buildMppConsumerEmail(data) {
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
  <div style="max-width:520px;margin:1.5rem auto 0 auto;font-size:.75rem;color:#999;line-height:1.6">${esc(MPP_LEGAL_DISCLAIMER)}</div>
</body></html>`;
}

async function handleLeadCapture(data, formName, createdAt) {
  const sends = [
    sendResendEmail({ from: `The Stewards <${MPP_FROM_EMAIL}>`, to: MPP_TEAM_EMAIL, subject: 'New Steward Tool Lead', html: buildMppTeamEmail(data, formName, createdAt) }),
  ];
  if (data.email) {
    sends.push(sendResendEmail({ from: `The Stewards <${MPP_FROM_EMAIL}>`, to: data.email, subject: 'Your Max Purchase Price Estimate', html: buildMppConsumerEmail(data) }));
  }
  return Promise.allSettled(sends);
}

// ─── refi-calculator.html ("refi-lead" form) ──────────────────────────────

const REFI_FROM_EMAIL = process.env.REFI_FROM_EMAIL || 'The Stewards <hello@stewards.loan>';
// Comma-separated env var value → real array, so Resend's `to` field gets
// proper multi-recipient handling instead of one malformed literal string.
const REFI_INTERNAL_EMAIL = (process.env.REFI_INTERNAL_EMAIL || '')
  .split(',')
  .map(function (s) { return s.trim(); })
  .filter(Boolean);

// Reused verbatim from the refi widget's on-page legal disclaimer.
const REFI_LEGAL_DISCLAIMER = `This calculator provides a general estimate based only on the figures you entered and does not constitute a loan approval, pre-qualification, offer of credit, or commitment to lend. It does not represent specific loan terms available to you or advertised by Ruoff Mortgage. Actual results depend on credit history, exact closing costs, escrow requirements, and full underwriting review. Ryan Miracle, Senior Loan Officer, NMLS #497698. Chris Beal, Loan Officer, NMLS #514071. Ruoff Mortgage, 8101 N High St Suite 300, Columbus OH 43235, NMLS #141868. Equal Housing Opportunity.`;

function buildRefiConsumerEmail(result) {
  const goalLabel = {
    lower_payment: 'lowering your monthly payment',
    lower_rate: 'lowering your rate',
    payoff_faster: 'paying off faster',
    cash_out: 'taking cash out',
  }[result.goal] || 'refinancing';

  const cashOutLine = result.cashOut
    ? `<p style="margin:0 0 8px 0;">Cash you'll receive at closing: <strong>${esc(result.cashOut)}</strong></p>`
    : '';

  return `
    <div style="font-family:Georgia,serif; color:#403d3d; max-width:520px; margin:0 auto;">
      <h1 style="font-family:Arial,sans-serif; font-size:22px; text-transform:uppercase; color:#403d3d;">Your Refinance Breakdown</h1>
      <p style="font-size:32px; font-weight:bold; color:#f76732; margin:16px 0;">${esc(result.resultNumber)}</p>
      <p style="font-size:16px; line-height:1.6;">${esc(result.resultSub)}</p>

      <div style="border-top:1px solid #ddd; margin-top:24px; padding-top:16px; font-size:15px; line-height:1.8;">
        <p style="margin:0 0 8px 0;">New estimated payment: <strong>${esc(result.newPayment)}</strong></p>
        <p style="margin:0 0 8px 0;">Monthly payment change: <strong>${esc(result.paymentChange)}</strong></p>
        <p style="margin:0 0 8px 0;">Break-even on closing costs: <strong>${esc(result.breakEven)}</strong></p>
        <p style="margin:0 0 8px 0;">Total cost, staying put (${esc(result.yearsStay)} yrs): <strong>${esc(result.totalCostCurrent)}</strong></p>
        <p style="margin:0 0 8px 0;">Total cost, after refinancing (${esc(result.yearsStay)} yrs): <strong>${esc(result.totalCostNew)}</strong></p>
        <p style="margin:0 0 8px 0;">Still owed, staying put: <strong>${esc(result.remainingCurrent)}</strong></p>
        <p style="margin:0 0 8px 0;">Still owed, after refinancing: <strong>${esc(result.remainingNew)}</strong></p>
        ${cashOutLine}
      </div>

      <div style="margin-top:28px; padding:20px; background:#403d3d; border-left:4px solid #f76732;">
        <p style="color:#fffae8; font-size:15px; line-height:1.6; margin:0 0 16px 0;">
          Since your goal was ${goalLabel}, a Steward can confirm this against your actual credit and give you a real number — usually within a day.
        </p>
        <p style="margin:0;">
          <a href="tel:+16147675273" style="color:#f76732; font-weight:bold; text-decoration:none;">Talk to a Steward: (614) 767-5273</a>
        </p>
      </div>

      <p style="font-size:12px; color:#999; line-height:1.6; margin-top:24px;">${esc(REFI_LEGAL_DISCLAIMER)}</p>
    </div>
  `;
}

function buildRefiInternalEmail(consumerEmail, result) {
  return `
    <div style="font-family:Arial,sans-serif; font-size:14px; color:#333;">
      <p><strong>New refi tool lead:</strong> ${esc(consumerEmail)}</p>
      <p>Goal: ${esc(result.goal)}</p>
      <p>Result: ${esc(result.resultNumber)} — ${esc(result.resultSub)}</p>
      <p>New payment: ${esc(result.newPayment)} (change: ${esc(result.paymentChange)})</p>
      <p>Break-even: ${esc(result.breakEven)}</p>
      <p>Total cost staying put vs refinancing (${esc(result.yearsStay)} yrs): ${esc(result.totalCostCurrent)} vs ${esc(result.totalCostNew)}</p>
      ${result.cashOut ? `<p>Cash out requested: ${esc(result.cashOut)}</p>` : ''}
    </div>
  `;
}

async function handleRefiLead(data) {
  const email = data.email;
  if (!email) return Promise.resolve([]);

  const result = {
    resultNumber: data.result_resultNumber || '',
    resultSub: data.result_resultSub || '',
    newPayment: data.result_newPayment || '',
    paymentChange: data.result_paymentChange || '',
    breakEven: data.result_breakEven || '',
    totalCostCurrent: data.result_totalCostCurrent || '',
    totalCostNew: data.result_totalCostNew || '',
    remainingCurrent: data.result_remainingCurrent || '',
    remainingNew: data.result_remainingNew || '',
    cashOut: data.result_cashOut || '',
    yearsStay: data.result_yearsStay || '',
    goal: data.result_goal || '',
  };

  const sends = [
    sendResendEmail({ from: REFI_FROM_EMAIL, to: email, subject: 'Your Refinance Breakdown', html: buildRefiConsumerEmail(result) }),
  ];
  if (REFI_INTERNAL_EMAIL.length) {
    sends.push(sendResendEmail({ from: REFI_FROM_EMAIL, to: REFI_INTERNAL_EMAIL, subject: `Refi Tool Lead: ${email}`, html: buildRefiInternalEmail(email, result) }));
  }
  return Promise.allSettled(sends);
}

// ─── Dispatcher ────────────────────────────────────────────────────────────
// Netlify's submission-created trigger is documented against the classic
// Lambda-compatible handler (event.body as a JSON string), not the newer
// fetch-style `export default (req) => {}` signature. Using the wrong
// signature here previously meant this function silently never reached the
// Resend call at all — no error, no send, nothing in Resend's own history.
exports.handler = async (event) => {
  console.log('[submission-created] invoked, raw body:', event.body);

  let payload;
  try {
    const parsed = JSON.parse(event.body);
    payload = parsed.payload ?? parsed;
  } catch (err) {
    console.error('[submission-created] failed to parse event.body:', err.message);
    return { statusCode: 400, body: 'Invalid payload' };
  }

  const data = payload?.data ?? {};
  const formName = payload?.form_name ?? 'unknown';
  const createdAt = new Date(payload?.created_at ?? Date.now()).toLocaleString('en-US', { timeZone: 'America/New_York' });

  console.log('[submission-created] form:', formName, 'data:', JSON.stringify(data));

  let results = [];
  if (formName === 'lead-capture') {
    results = await handleLeadCapture(data, formName, createdAt);
  } else if (formName === 'refi-lead') {
    results = await handleRefiLead(data);
  } else {
    console.error('[submission-created] unrecognized form_name, no email sent:', formName);
  }

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[submission-created] send ${i} failed for form ${formName}:`, r.reason?.message ?? r.reason);
    } else {
      console.log(`[submission-created] send ${i} succeeded for form ${formName}`);
    }
  });

  // Netlify doesn't act on the response, but return 200 so this doesn't show
  // up as a failed invocation in the function logs.
  return { statusCode: 200, body: 'ok' };
};
