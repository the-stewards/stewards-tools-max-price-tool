// netlify/functions/submission-created.js
//
// THIS FILE MUST BE NAMED EXACTLY submission-created.js AND LIVE AT
// netlify/functions/submission-created.js — Netlify only auto-invokes a
// function with this EXACT name on every form submission, for every form
// on the site. A custom-named function (e.g. "refi-lead-notify.js") will
// NEVER be auto-triggered by a real form submission — it only works when
// called directly via its own URL, which is why that bug wasn't caught
// during isolated testing on the refi tool build. Do not split this back
// out into per-tool files.
//
// Classic handler signature only (`exports.handler = async (event) => {}`)
// — the fetch-style `export default async (req) => {}` signature silently
// 400s on Netlify. Confirmed the hard way on tool #1's build.
//
// Dispatches on `payload.form_name` to route each form to its own email
// logic below. Add new tools' forms as new cases in the switch statement —
// never as a new standalone function file.

const RESEND_API_URL = 'https://api.resend.com/emails';
const RESEND_API_KEY = process.env.RESEND_API_KEY; // shared across all tools, set as NON-secret
const FROM_EMAIL = process.env.STEWARDS_FROM_EMAIL || 'The Stewards <hello@stewards.loan>';
const INTERNAL_NOTIFY_EMAIL = process.env.STEWARDS_INTERNAL_EMAIL; // Ryan + Chris

// Reused verbatim across every tool's email — never rewritten per channel.
const LEGAL_DISCLAIMER = `This is general information based only on what was entered or submitted, and does not constitute a loan approval, pre-qualification, offer of credit, or commitment to lend. Ryan Miracle, Senior Loan Officer, NMLS #497698. Chris Beal, Loan Officer, NMLS #514071. Ruoff Mortgage, 8101 N High St Suite 300, Columbus OH 43235, NMLS #141868. Equal Housing Opportunity.`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    console.error('Failed to parse submission payload');
    return { statusCode: 400, body: 'Bad Request' };
  }

  const formName = payload.form_name || (payload.payload && payload.payload.form_name);
  const data = (payload.payload && payload.payload.data) || payload.data || {};

  try {
    switch (formName) {
      case 'lead-capture':
        await handleLeadCapture(data, formName);
        break;
      case 'refi-lead':
        await handleRefiLead(data);
        break;
      case 'loan-estimate-lead':
        await handleLoanEstimateLead(data);
        break;
      case 'second-look-lead':
        await handleSecondLookLead(data);
        break;
      case 'down-payment-lead':
        await handleDownPaymentLead(data);
        break;
      default:
        console.error('Unrecognized form_name on submission:', formName);
        return { statusCode: 200, body: 'Unrecognized form, no action taken' };
    }
    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    // Verify actual delivery via Resend's send history, not this 200/500 —
    // client-side "Sent" and a function returning 200 both proved nothing
    // on two prior builds until checked against Resend directly.
    console.error('Email send failed for form', formName, ':', err.message);
    return { statusCode: 500, body: 'Email send failed' };
  }
};

// ---------------------------------------------------------------------
// Shared small helpers (used by tool #1's richer HTML template below)
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// Tool #1 — What Can I Afford (max-purchase-price.html, form "lead-capture")
// ---------------------------------------------------------------------
async function handleLeadCapture(data, formName) {
  const email = data.email;

  const teamHtml = `<!DOCTYPE html>
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
    </table>
  </div>
</body></html>`;

  const loanAmount = Math.max(Number(data.estimated_price ?? 0) - Number(data.down_payment ?? 0), 0);
  const contextLine = data.total_monthly_payment && data.rate
    ? `Based on an estimated ${formatMoney(data.total_monthly_payment)}/mo payment and a ${esc(data.rate)}% rate.`
    : '';
  const pmiRow = Number(data.monthly_pmi) > 0
    ? `<tr><td style="padding:.4rem 0;color:#7a7474">Est. Monthly PMI</td><td style="padding:.4rem 0">${formatMoney(data.monthly_pmi)}</td></tr>`
    : '';

  const consumerHtml = `<!DOCTYPE html>
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

  const sends = [
    INTERNAL_NOTIFY_EMAIL ? sendEmail(INTERNAL_NOTIFY_EMAIL, 'New Steward Tool Lead', teamHtml) : Promise.resolve(),
  ];
  if (email) {
    sends.push(sendEmail(email, 'Your Max Purchase Price Estimate', consumerHtml));
  }
  await Promise.all(sends);
}

// ---------------------------------------------------------------------
// Tool #2 — Should You Refinance
// ---------------------------------------------------------------------
async function handleRefiLead(data) {
  const email = data.email;
  if (!email) return;

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
    goal: data.result_goal || ''
  };

  const goalLabel = {
    lower_payment: 'lowering your monthly payment',
    lower_rate: 'lowering your rate',
    payoff_faster: 'paying off faster',
    cash_out: 'taking cash out'
  }[result.goal] || 'refinancing';

  const cashOutLine = result.cashOut
    ? `<p style="margin:0 0 8px 0;">Cash you'll receive at closing: <strong>${result.cashOut}</strong></p>`
    : '';

  const consumerHtml = `
    <div style="font-family:Georgia,serif; color:#403d3d; max-width:520px; margin:0 auto;">
      <h1 style="font-family:Arial,sans-serif; font-size:22px; text-transform:uppercase;">Your Refinance Breakdown</h1>
      <p style="font-size:32px; font-weight:bold; color:#f76732; margin:16px 0;">${result.resultNumber}</p>
      <p style="font-size:16px; line-height:1.6;">${result.resultSub}</p>
      <div style="border-top:1px solid #ddd; margin-top:24px; padding-top:16px; font-size:15px; line-height:1.8;">
        <p style="margin:0 0 8px 0;">New estimated payment: <strong>${result.newPayment}</strong></p>
        <p style="margin:0 0 8px 0;">Monthly payment change: <strong>${result.paymentChange}</strong></p>
        <p style="margin:0 0 8px 0;">Break-even on closing costs: <strong>${result.breakEven}</strong></p>
        <p style="margin:0 0 8px 0;">Total cost, staying put (${result.yearsStay} yrs): <strong>${result.totalCostCurrent}</strong></p>
        <p style="margin:0 0 8px 0;">Total cost, after refinancing (${result.yearsStay} yrs): <strong>${result.totalCostNew}</strong></p>
        <p style="margin:0 0 8px 0;">Still owed, staying put: <strong>${result.remainingCurrent}</strong></p>
        <p style="margin:0 0 8px 0;">Still owed, after refinancing: <strong>${result.remainingNew}</strong></p>
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
      <p style="font-size:12px; color:#999; line-height:1.6; margin-top:24px;">${LEGAL_DISCLAIMER}</p>
    </div>
  `;

  const internalHtml = `
    <div style="font-family:Arial,sans-serif; font-size:14px; color:#333;">
      <p><strong>New refi tool lead:</strong> ${email}</p>
      <p>Goal: ${result.goal}</p>
      <p>Result: ${result.resultNumber} — ${result.resultSub}</p>
      <p>New payment: ${result.newPayment} (change: ${result.paymentChange})</p>
      <p>Break-even: ${result.breakEven}</p>
      ${result.cashOut ? `<p>Cash out requested: ${result.cashOut}</p>` : ''}
    </div>
  `;

  await Promise.all([
    sendEmail(email, 'Your Refinance Breakdown', consumerHtml),
    INTERNAL_NOTIFY_EMAIL ? sendEmail(INTERNAL_NOTIFY_EMAIL, `Refi Tool Lead: ${email}`, internalHtml) : Promise.resolve()
  ]);
}

// ---------------------------------------------------------------------
// Tool #3 (superseded, kept parked per handoff §8/§9.6 — not deployed as
// live tool #3, but the case stays here harmlessly in case no HTML in this
// repo ever posts form_name "loan-estimate-lead", nothing triggers it).
// Confirmation-only by design — no extracted figures are transmitted,
// since this tool touches real uploaded-document PII on the upload path.
// ---------------------------------------------------------------------
async function handleLoanEstimateLead(data) {
  const email = data.email;
  if (!email) return;

  const consumerHtml = `
    <div style="font-family:Georgia,serif; color:#403d3d; max-width:520px; margin:0 auto;">
      <h1 style="font-family:Arial,sans-serif; font-size:22px; text-transform:uppercase;">A Steward Will Follow Up</h1>
      <p style="font-size:16px; line-height:1.7;">Thanks for checking your Loan Estimate against typical ranges. A Steward will reach out to walk through anything worth a closer look — no cost, no obligation.</p>
      <p style="font-size:12px; color:#999; line-height:1.6; margin-top:24px;">${LEGAL_DISCLAIMER}</p>
    </div>
  `;

  const internalHtml = `
    <div style="font-family:Arial,sans-serif; font-size:14px; color:#333;">
      <p><strong>New Loan Estimate checker lead:</strong> ${email}</p>
      <p>No further detail transmitted by design — this tool's lead capture is confirmation-only.</p>
    </div>
  `;

  await Promise.all([
    sendEmail(email, 'A Steward Will Follow Up', consumerHtml),
    INTERNAL_NOTIFY_EMAIL ? sendEmail(INTERNAL_NOTIFY_EMAIL, `Loan Estimate Tool Lead: ${email}`, internalHtml) : Promise.resolve()
  ]);
}

// ---------------------------------------------------------------------
// Tool #4 — Second Look (upload Loan Estimate, human reviews within 24h)
//
// UNVERIFIED — needs confirmation during build/test, flagging honestly:
// Netlify Forms is expected to store the uploaded file and populate
// `data.loanEstimate` with a URL to the stored file rather than the raw
// binary, per Netlify's documented file-upload handling. This has not
// been tested in this session. Confirm the actual shape of `data` on a
// real submission (via Netlify's submissions API or dashboard) before
// trusting that the internal email's file link actually works.
// ---------------------------------------------------------------------
async function handleSecondLookLead(data) {
  const email = data.email;
  if (!email) return;

  // Netlify delivers file-upload fields as an object ({filename,type,size,url}),
  // not a plain URL string — confirmed via a real submission whose email
  // rendered href="[object Object]" until this was fixed.
  const fileUrl = data.loanEstimate && data.loanEstimate.url;
  const fileName = (data.loanEstimate && data.loanEstimate.filename) || 'loan-estimate';

  const fileLink = fileUrl
    ? `<p style="margin:0 0 8px 0;"><a href="${esc(fileUrl)}">View uploaded Loan Estimate</a></p>`
    : `<p style="margin:0 0 8px 0; color:#c00;">No file URL found in submission data — check the Netlify Forms dashboard directly for this submission.</p>`;

  // Base64 inflates size ~33% — stay well under Resend/SES's combined
  // request-size ceiling rather than risking the whole send failing.
  const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
  let attachments;
  if (fileUrl) {
    try {
      const fileRes = await fetch(fileUrl);
      if (fileRes.ok) {
        const declaredSize = Number(fileRes.headers.get('content-length'));
        if (declaredSize && declaredSize > MAX_ATTACHMENT_BYTES) {
          console.error('Uploaded file too large to attach, falling back to link only:', declaredSize);
        } else {
          const buf = Buffer.from(await fileRes.arrayBuffer());
          if (buf.length > MAX_ATTACHMENT_BYTES) {
            console.error('Uploaded file too large to attach, falling back to link only:', buf.length);
          } else {
            attachments = [{ filename: fileName, content: buf.toString('base64') }];
          }
        }
      } else {
        console.error('Failed to fetch uploaded file for attachment, status', fileRes.status);
      }
    } catch (err) {
      console.error('Failed to fetch uploaded file for attachment:', err.message);
    }
  }

  const consumerHtml = `
    <div style="font-family:Georgia,serif; color:#403d3d; max-width:520px; margin:0 auto;">
      <h1 style="font-family:Arial,sans-serif; font-size:22px; text-transform:uppercase;">We're On It</h1>
      <p style="font-size:16px; line-height:1.7;">Thanks, ${data.firstName || ''} — a Steward is reviewing your Loan Estimate now. Expect to hear back within 24 hours, usually sooner.</p>
      <p style="font-size:12px; color:#999; line-height:1.6; margin-top:24px;">This is a request for a manual review by a licensed loan officer, not an automated quote, loan approval, pre-qualification, offer of credit, or commitment to lend. Ryan Miracle, Senior Loan Officer, NMLS #497698. Chris Beal, Loan Officer, NMLS #514071. Ruoff Mortgage, 8101 N High St Suite 300, Columbus OH 43235, NMLS #141868. Equal Housing Opportunity.</p>
    </div>
  `;

  const internalHtml = `
    <div style="font-family:Arial,sans-serif; font-size:14px; color:#333; line-height:1.8;">
      <p><strong>New Second Look lead — review within 24 hours</strong></p>
      <p>Name: ${data.firstName || ''} ${data.lastName || ''}</p>
      <p>Email: ${email}</p>
      <p>Phone: ${data.phone || ''}</p>
      <p>Property State: ${data.propertyState || ''}</p>
      <p>Closing Date: ${data.closingDate || ''}</p>
      <p>Credit Score: ${data.creditScore || 'Not provided'}</p>
      <p>Property Type: ${data.propertyType || ''}</p>
      <p>Property Usage: ${data.propertyUsage || ''}</p>
      <p>Notes: ${data.notes || 'None'}</p>
      ${fileLink}
    </div>
  `;

  await Promise.all([
    sendEmail(email, "We're On It — Your Second Look Request", consumerHtml),
    INTERNAL_NOTIFY_EMAIL ? sendEmail(INTERNAL_NOTIFY_EMAIL, `Second Look Lead: ${data.firstName || ''} ${data.lastName || ''}`, internalHtml, attachments) : Promise.resolve()
  ]);
}

// ---------------------------------------------------------------------
// Down Payment Help Finder — confirmation-only, matching the loan-estimate
// checker pattern. Results shown to the user are currently sample/mock
// data (pending real DPA data source integration), so there are no real
// program figures worth transmitting in an email yet. Revisit once the
// matching logic is wired to a real data source.
// ---------------------------------------------------------------------
async function handleDownPaymentLead(data) {
  const email = data.email;
  if (!email) return;

  const consumerHtml = `
    <div style="font-family:Georgia,serif; color:#403d3d; max-width:520px; margin:0 auto;">
      <h1 style="font-family:Arial,sans-serif; font-size:22px; text-transform:uppercase;">A Steward Will Follow Up</h1>
      <p style="font-size:16px; line-height:1.7;">Thanks for checking out down payment assistance options. A Steward will follow up to confirm what you actually qualify for and help stack the right programs together.</p>
      <p style="font-size:12px; color:#999; line-height:1.6; margin-top:24px;">${LEGAL_DISCLAIMER}</p>
    </div>
  `;

  const internalHtml = `
    <div style="font-family:Arial,sans-serif; font-size:14px; color:#333;">
      <p><strong>New Down Payment Finder lead:</strong> ${email}</p>
      <p>No further detail transmitted by design — this tool's lead capture is confirmation-only, and current results are sample/mock data pending real DPA data source integration.</p>
    </div>
  `;

  await Promise.all([
    sendEmail(email, 'A Steward Will Follow Up', consumerHtml),
    INTERNAL_NOTIFY_EMAIL ? sendEmail(INTERNAL_NOTIFY_EMAIL, `Down Payment Finder Lead: ${email}`, internalHtml) : Promise.resolve()
  ]);
}

// ---------------------------------------------------------------------
async function sendEmail(to, subject, html, attachments) {
  const payload = { from: FROM_EMAIL, to, subject, html };
  if (attachments && attachments.length) payload.attachments = attachments;

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend API error ${res.status}: ${text}`);
  }
  return res.json();
}
