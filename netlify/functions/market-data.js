// netlify/functions/market-data.js
//
// Backend for the Market Snapshot tool (market-data-tool.html). Called
// client-side as GET /.netlify/functions/market-data?zip=43215.
//
// STATUS (2026-08-01): partially live. Wired up and verified:
//   - zip -> county resolution (Census ZCTA-to-county crosswalk, bundled
//     locally as data/zip-county-lookup.json, no key required)
//   - historicalAppreciation (FHFA's county-level All-Transactions HPI,
//     pulled via FRED's mirror series ATNHPIUS{countyFips}A rather than
//     scraping FHFA's own CSV catalog directly - confirmed working
//     against FRED's real API response, not assumed)
//   - currentMortgageRate (FRED MORTGAGE30US, used by the affordability
//     index once income data is live)
//
// CENSUS — CODE-COMPLETE, GATED ON CENSUS_API_KEY (2026-08-01):
//   Confirmed 2026-08-01 that Census's keyless testing tier is gone —
//   every request now hard-requires a key (verified: a real unkeyed
//   call returns an HTML "Missing Key" page, not JSON). Ryan's key
//   signup emails aren't arriving; separate issue, being chased.
//
//   Because there was no way to test a live authenticated response,
//   getMedianIncome() and getTenure() below are written against
//   Census's documented, stable ACS API contract (array-of-arrays,
//   header row + one data row per geography — unchanged across ACS
//   releases for years) rather than a verified real response. The
//   moment CENSUS_API_KEY is set, hit this function once and confirm
//   the actual shape before trusting it — same discipline that caught
//   the FHFA CSV URL guess being wrong (that one 404'd loudly; a wrong
//   ACS variable code would fail silently with a plausible-looking
//   wrong number, which is worse).
//
//   Deliberately NOT attempted yet, left pending even once the key
//   works:
//   - demographics (age brackets) — ACS table B01001 needs ~20 exact
//     sex/age cell codes summed into 4 custom brackets. Getting one
//     cell boundary wrong produces a wrong-but-plausible number with
//     no error to catch it. Needs a verification pass against Census's
//     own table docs before writing, not a from-memory guess.
//   - permitsPerYear — Census's Building Permits Survey is a different,
//     less-familiar timeseries API (not the ACS pattern above). Endpoint
//     shape not confirmed; needs its own research pass.
//   - affordabilityIndex — needs income (about to be live) AND
//     medianPrice (Tier 2, not built — see below). Getting the Census
//     key does NOT unblock this one by itself; flagging so that's not
//     forgotten when the key lands and this still shows "Pending."
//
// STILL MOCK (Tier 2/3, not started):
//   - medianPrice, medianDaysOnMarket, activeListings (Redfin/Realtor.com
//     periodic exports - access method not yet verified)
//   - forecastedAppreciation (Tier 3, vendor decision not made)
//
// Classic handler signature only, same rule as every other function in
// this project - the fetch-style signature silently 400s on Netlify.

const fs = require('fs');
const path = require('path');

const FRED_API_KEY = process.env.FRED_API_KEY;
const CENSUS_API_KEY = process.env.CENSUS_API_KEY; // not set yet as of 2026-08-01

let ZIP_COUNTY_LOOKUP = null;
function loadZipCountyLookup() {
  if (!ZIP_COUNTY_LOOKUP) {
    const raw = fs.readFileSync(path.join(__dirname, 'data', 'zip-county-lookup.json'), 'utf-8');
    ZIP_COUNTY_LOOKUP = JSON.parse(raw);
  }
  return ZIP_COUNTY_LOOKUP;
}

async function fetchFredObservations(seriesId, opts) {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: FRED_API_KEY,
    file_type: 'json',
    sort_order: 'desc',
    ...opts
  });
  const res = await fetch(`https://api.stlouisfed.org/fred/series/observations?${params}`);
  if (!res.ok) throw new Error(`FRED API error ${res.status} for series ${seriesId}`);
  const json = await res.json();
  return json.observations || [];
}

function annualizedPct(startValue, endValue, years) {
  if (!startValue || !endValue || startValue <= 0 || years <= 0) return null;
  return Math.round((Math.pow(endValue / startValue, 1 / years) - 1) * 1000) / 10; // one decimal
}

async function getHistoricalAppreciation(countyFips) {
  // FHFA's county-level All-Transactions HPI, annual, mirrored on FRED.
  // "Developmental" per FHFA's own notes for small counties - can come
  // back sparse/missing for very low-population counties.
  const seriesId = `ATNHPIUS${countyFips}A`;
  let obs;
  try {
    obs = await fetchFredObservations(seriesId, { limit: 60 });
  } catch (err) {
    console.error('Historical appreciation fetch failed for', countyFips, ':', err.message);
    return null;
  }
  const clean = obs
    .filter(o => o.value && o.value !== '.')
    .map(o => ({ year: Number(o.date.slice(0, 4)), value: Number(o.value) }))
    .sort((a, b) => b.year - a.year);

  if (clean.length < 2) return null;

  const latest = clean[0];
  const find = (yearsBack) => clean.find(o => o.year === latest.year - yearsBack);
  const fiveYrPoint = find(5);
  const tenYrPoint = find(10);
  const longRunPoint = clean[clean.length - 1];

  return {
    fiveYr: fiveYrPoint ? annualizedPct(fiveYrPoint.value, latest.value, latest.year - fiveYrPoint.year) : null,
    tenYr: tenYrPoint ? annualizedPct(tenYrPoint.value, latest.value, latest.year - tenYrPoint.year) : null,
    longRun: longRunPoint ? annualizedPct(longRunPoint.value, latest.value, latest.year - longRunPoint.year) : null,
    asOfYear: latest.year
  };
}

async function getCurrentMortgageRate() {
  try {
    const obs = await fetchFredObservations('MORTGAGE30US', { limit: 1 });
    return obs.length ? Number(obs[0].value) : null;
  } catch (err) {
    console.error('Mortgage rate fetch failed:', err.message);
    return null;
  }
}

async function fetchCensusJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Census API error ${res.status}`);
  const json = await res.json();
  // ACS returns a 2D array: [headerRow, dataRow1, dataRow2, ...]. Treat
  // anything else (e.g. the "Missing Key" HTML page, or an error JSON
  // object) as a shape mismatch rather than silently indexing into it.
  if (!Array.isArray(json) || json.length < 2) {
    throw new Error('Unexpected Census response shape: ' + JSON.stringify(json).slice(0, 200));
  }
  return json;
}

async function getMedianIncome(countyFips) {
  const stateFips = countyFips.slice(0, 2);
  const countyOnly = countyFips.slice(2);
  try {
    const [localRows, nationalRows] = await Promise.all([
      fetchCensusJson(`https://api.census.gov/data/2023/acs/acs5?get=NAME,B19013_001E&for=county:${countyOnly}&in=state:${stateFips}&key=${CENSUS_API_KEY}`),
      fetchCensusJson(`https://api.census.gov/data/2023/acs/acs5?get=NAME,B19013_001E&for=us:*&key=${CENSUS_API_KEY}`)
    ]);
    const local = Number(localRows[1][1]);
    const national = Number(nationalRows[1][1]);
    if (!local || !national) return null;
    return { local, national };
  } catch (err) {
    console.error('Census median income fetch failed for', countyFips, ':', err.message);
    return null;
  }
}

async function getTenure(countyFips) {
  const stateFips = countyFips.slice(0, 2);
  const countyOnly = countyFips.slice(2);
  try {
    const rows = await fetchCensusJson(`https://api.census.gov/data/2023/acs/acs5?get=NAME,B25003_002E,B25003_003E&for=county:${countyOnly}&in=state:${stateFips}&key=${CENSUS_API_KEY}`);
    const [, owner, renter] = rows[1];
    const homeowners = Number(owner);
    const renters = Number(renter);
    if (!homeowners || !renters) return null;
    return { homeowners, renters };
  } catch (err) {
    console.error('Census tenure fetch failed for', countyFips, ':', err.message);
    return null;
  }
}

async function getCensusData(countyFips) {
  if (!CENSUS_API_KEY) {
    return { pending: true, medianIncome: null, tenure: null, permitsPerYear: null, demographics: null, affordabilityIndex: null };
  }
  const [medianIncome, tenure] = await Promise.all([
    getMedianIncome(countyFips),
    getTenure(countyFips)
  ]);
  return {
    pending: false,
    medianIncome,
    tenure,
    permitsPerYear: null, // needs its own endpoint research - see comment block above
    demographics: null,   // needs its own verification pass - see comment block above
    affordabilityIndex: null // blocked on medianPrice (Tier 2, not built) even with income+rate live
  };
}

exports.handler = async (event) => {
  const zip = (event.queryStringParameters && event.queryStringParameters.zip || '').trim();
  if (!/^[0-9]{5}$/.test(zip)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Provide a valid 5-digit zip via ?zip=' }) };
  }

  const lookup = loadZipCountyLookup();
  const county = lookup[zip];
  if (!county) {
    return { statusCode: 200, body: JSON.stringify({ resolved: false }) };
  }

  const [historicalAppreciation, currentMortgageRate, census] = await Promise.all([
    getHistoricalAppreciation(county.countyFips),
    getCurrentMortgageRate(),
    getCensusData(county.countyFips)
  ]);

  const result = {
    resolved: true,
    locationName: `${county.countyName}, ${county.state}`,
    countyFips: county.countyFips,

    // Live
    historicalAppreciation,
    currentMortgageRate,

    // Live once CENSUS_API_KEY is set (income, tenure); permits,
    // demographics, and affordabilityIndex stay pending regardless -
    // see the comment block above for why.
    census,

    // Not started - Tier 2 (periodic export access unverified) / Tier 3 (vendor decision pending)
    medianPrice: null,
    medianDaysOnMarket: null,
    activeListings: null,
    forecastedAppreciation: null
  };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result)
  };
};
