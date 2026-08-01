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
// STILL PENDING (needs CENSUS_API_KEY, not yet provided):
//   - medianIncome, permitsPerYear, demographics, tenure — Census ACS /
//     Building Permits Survey. Stubbed to return null with a `pending:
//     true` flag rather than fabricated numbers. NOT YET CODED against a
//     verified real Census API response shape - do that before flipping
//     `census: true` below, same discipline as the FHFA lookup: confirm
//     the actual response first, don't build on assumption.
//   - affordabilityIndex - depends on medianIncome, so pending with it.
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

  const [historicalAppreciation, currentMortgageRate] = await Promise.all([
    getHistoricalAppreciation(county.countyFips),
    getCurrentMortgageRate()
  ]);

  const result = {
    resolved: true,
    locationName: `${county.countyName}, ${county.state}`,
    countyFips: county.countyFips,

    // Live
    historicalAppreciation,
    currentMortgageRate,

    // Pending Census key - null + flag rather than fabricated numbers
    census: {
      pending: !CENSUS_API_KEY,
      medianIncome: null,
      permitsPerYear: null,
      demographics: null,
      tenure: null,
      affordabilityIndex: null
    },

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
