// netlify/functions/refi-lead-notify.js
//
// IMPORTANT — classic handler signature only. The newer
// `export default async (req) => {}` fetch-style signature silently
// returns 400 before this ever runs. Learned the hard way on the
// max-purchase-price build. Do not "modernize" this.

const RESEND_API_URL = 'https://api.resend.com/emails';

// Set in Netlify env vars as NON-secret (secret:true vars were not
// actually readable via process.env in the deployed function last time).
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.REFI_FROM_EMAIL || 'The Stewards <hello@stewards.loan>';
// Comma-separated env var value → real array, so Resend's `to` field gets
// proper multi-recipient handling instead of one malformed literal string.
const INTERNAL_NOTIFY_EMAIL = (process.env.REFI_INTERNAL_EMAIL || '')
  .split(',')
  .map(function (s) { return s.trim(); })
  .filter(Boolean);

// Reused verbatim from the on-page legal disclaimer. Do not rewrite this
// for the email channel — same compliance-adjacent copy, same wording.
const LEGAL_DISCLAIMER = `This calculator provides a general estimate based only on the figures you entered and does not constitute a loan approval, pre-qualification, offer of credit, or commitment to lend. It does not represent specific loan terms available to you or advertised by Ruoff Mortgage. Actual results depend on credit history, exact closing costs, escrow requirements, and full underwriting review. Ryan Miracle, Senior Loan Officer, NMLS #497698. Chris Beal, Loan Officer, NMLS #514071. Ruoff Mortgage, 8101 N High St Suite 300, Columbus OH 43235, NMLS #141868. Equal Housing Opportunity.`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    console.error('Failed to parse submission payload:', err);
    return { statusCode: 400, body: 'Bad Request' };
  }

  // Netlify's submission-created payload nests the actual form data here.
  const data = (payload.payload && payload.payload.data) || {};
  const email = data.email;

  if (!email) {
    console.error('No email present on submission payload — nothing to send.');
    return { statusCode: 200, body: 'No email, skipped' };
  }

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

  try {
    await Promise.all([
      sendConsumerEmail(email, result),
      INTERNAL_NOTIFY_EMAIL.length ? sendInternalEmail(email, result) : Promise.resolve()
    ]);
    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    // If this fails, the on-page "Sent" message will still have shown the
    // visitor a confirmation with no email actually delivered. Verify via
    // Resend's own send history, not just this function returning 200 —
    // same trap that cost a full debug day last time.
    console.error('Email send failed:', err);
    return { statusCode: 500, body: 'Email send failed' };
  }
};

async function sendConsumerEmail(toEmail, result) {
  const goalLabel = {
    lower_payment: 'lowering your monthly payment',
    lower_rate: 'lowering your rate',
    payoff_faster: 'paying off faster',
    cash_out: 'taking cash out'
  }[result.goal] || 'refinancing';

  const cashOutLine = result.cashOut
    ? `<p style="margin:0 0 8px 0;">Cash you'll receive at closing: <strong>${result.cashOut}</strong></p>`
    : '';

  const html = `
    <div style="font-family:Georgia,serif; color:#403d3d; max-width:520px; margin:0 auto;">
      <h1 style="font-family:Arial,sans-serif; font-size:22px; text-transform:uppercase; color:#403d3d;">Your Refinance Breakdown</h1>
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
          <a href="https://stewards.loan" style="color:#f76732; font-weight:bold; text-decoration:none;">Talk to a Steward &rarr;</a>
          &nbsp;or call <a href="tel:+16147675273" style="color:#f76732; font-weight:bold; text-decoration:none;">(614) 767-5273</a>
        </p>
      </div>

      <p style="font-size:12px; color:#999; line-height:1.6; margin-top:24px;">${LEGAL_DISCLAIMER}</p>
    </div>
  `;

  return fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: toEmail,
      subject: 'Your Refinance Breakdown',
      html: html
    })
  }).then(checkResendResponse);
}

async function sendInternalEmail(consumerEmail, result) {
  const html = `
    <div style="font-family:Arial,sans-serif; font-size:14px; color:#333;">
      <p><strong>New refi tool lead:</strong> ${consumerEmail}</p>
      <p>Goal: ${result.goal}</p>
      <p>Result: ${result.resultNumber} — ${result.resultSub}</p>
      <p>New payment: ${result.newPayment} (change: ${result.paymentChange})</p>
      <p>Break-even: ${result.breakEven}</p>
      <p>Total cost staying put vs refinancing (${result.yearsStay} yrs): ${result.totalCostCurrent} vs ${result.totalCostNew}</p>
      ${result.cashOut ? `<p>Cash out requested: ${result.cashOut}</p>` : ''}
    </div>
  `;

  return fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: INTERNAL_NOTIFY_EMAIL,
      subject: `Refi Tool Lead: ${consumerEmail}`,
      html: html
    })
  }).then(checkResendResponse);
}

async function checkResendResponse(res) {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend API error ${res.status}: ${text}`);
  }
  return res.json();
}
