// netlify/functions/purge-old-submissions.js
//
// Scheduled function (see netlify.toml) — runs daily, deletes any form
// submission across every form on this site older than RETENTION_DAYS.
// Ryan's call (2026-08-01): leads live 30 days, then get purged. Applies
// to every tool sharing this site (lead-capture, refi-lead,
// second-look-lead, down-payment-lead, and anything added later) — forms
// are discovered dynamically so a new tool's form is covered automatically,
// no code change needed here when the next tool ships.
//
// Classic handler signature only, same rule as submission-created.js —
// the fetch-style `export default async (req) => {}` signature silently
// 400s on Netlify.
//
// Requires NETLIFY_API_TOKEN (a Personal Access Token from Ryan's own
// Netlify account — https://app.netlify.com/user/applications under
// "Personal access tokens") and NETLIFY_SITE_ID. Both must be set
// non-secret per this project's established env var bug: a var marked
// secret was silently unreadable via process.env at runtime (confirmed
// the hard way on RESEND_API_KEY during tool #1's build).

const NETLIFY_API_TOKEN = process.env.NETLIFY_API_TOKEN;
const NETLIFY_SITE_ID = process.env.NETLIFY_SITE_ID;
const RETENTION_DAYS = 30;
const API_BASE = 'https://api.netlify.com/api/v1';

exports.handler = async () => {
  if (!NETLIFY_API_TOKEN || !NETLIFY_SITE_ID) {
    console.error('purge-old-submissions: missing NETLIFY_API_TOKEN or NETLIFY_SITE_ID, skipping run');
    return { statusCode: 200, body: 'Skipped - not configured' };
  }

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const authHeaders = { Authorization: `Bearer ${NETLIFY_API_TOKEN}` };

  let formsRes;
  try {
    formsRes = await fetch(`${API_BASE}/sites/${NETLIFY_SITE_ID}/forms`, { headers: authHeaders });
  } catch (err) {
    console.error('purge-old-submissions: failed to fetch forms list:', err.message);
    return { statusCode: 500, body: 'Failed to fetch forms' };
  }
  if (!formsRes.ok) {
    console.error('purge-old-submissions: forms list request failed, status', formsRes.status);
    return { statusCode: 500, body: 'Failed to fetch forms' };
  }
  const forms = await formsRes.json();

  let deletedCount = 0;
  let errorCount = 0;

  for (const form of forms) {
    let submissions;
    try {
      const subsRes = await fetch(`${API_BASE}/forms/${form.id}/submissions`, { headers: authHeaders });
      if (!subsRes.ok) {
        console.error(`purge-old-submissions: submissions fetch failed for form ${form.name}, status`, subsRes.status);
        errorCount++;
        continue;
      }
      submissions = await subsRes.json();
    } catch (err) {
      console.error(`purge-old-submissions: submissions fetch threw for form ${form.name}:`, err.message);
      errorCount++;
      continue;
    }

    for (const sub of submissions) {
      const createdAt = new Date(sub.created_at).getTime();
      if (createdAt >= cutoff) continue;

      try {
        const delRes = await fetch(`${API_BASE}/submissions/${sub.id}`, { method: 'DELETE', headers: authHeaders });
        if (delRes.ok) {
          deletedCount++;
        } else {
          console.error(`purge-old-submissions: delete failed for submission ${sub.id}, status`, delRes.status);
          errorCount++;
        }
      } catch (err) {
        console.error(`purge-old-submissions: delete threw for submission ${sub.id}:`, err.message);
        errorCount++;
      }
    }
  }

  console.log(`purge-old-submissions: deleted ${deletedCount} submission(s) older than ${RETENTION_DAYS} days, ${errorCount} error(s)`);
  return { statusCode: 200, body: `Deleted ${deletedCount}, errors ${errorCount}` };
};
