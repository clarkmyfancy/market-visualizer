const express = require('express');
const path = require('path');
const { Readable } = require('stream');

const app = express();

const DIST_PATH = path.join(__dirname, 'dist/market-visualizer');
const FRED_GRAPH_CSV_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
const FRED_SERIES_TXT_URL = 'https://fred.stlouisfed.org/data/MEDLISPRI12420.txt';
const COINGECKO_PRO_BASE_URL = 'https://pro-api.coingecko.com/api/v3';
const COINGECKO_PUBLIC_BASE_URL = 'https://api.coingecko.com/api/v3';
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY?.trim() || '';

app.use('/api', (req, res, next) => {
  const origin = req.headers.origin ?? '';
  const isLocalOrigin =
    typeof origin === 'string' &&
    (origin.startsWith('http://localhost:4200') || origin.startsWith('http://127.0.0.1:4200'));

  if (isLocalOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
});

async function proxyFredAustinMedianListing(req, res) {
  const cosd = typeof req.query.cosd === 'string' ? req.query.cosd : '';
  const coed = typeof req.query.coed === 'string' ? req.query.coed : '';

  const boundedCsvUrl = new URL(FRED_GRAPH_CSV_URL);
  boundedCsvUrl.searchParams.set('id', 'MEDLISPRI12420');
  if (cosd) boundedCsvUrl.searchParams.set('cosd', cosd);
  if (coed) boundedCsvUrl.searchParams.set('coed', coed);

  const fallbackTxtUrl = new URL(FRED_SERIES_TXT_URL);
  if (cosd) fallbackTxtUrl.searchParams.set('cosd', cosd);
  if (coed) fallbackTxtUrl.searchParams.set('coed', coed);

  const attempts = [];
  const fetchWithTimeout = async (url, timeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const upstreamCandidates = [
    { label: 'FRED graph csv', url: boundedCsvUrl, timeoutMs: 12000 },
    { label: 'FRED txt fallback', url: fallbackTxtUrl, timeoutMs: 8000 },
  ];

  for (const candidate of upstreamCandidates) {
    try {
      const upstream = await fetchWithTimeout(candidate.url, candidate.timeoutMs);
      if (!upstream.ok) {
        attempts.push(`${candidate.label}: HTTP ${upstream.status}`);
        continue;
      }

      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/csv; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=1800');

      if (upstream.body) {
        Readable.fromWeb(upstream.body).pipe(res);
        return;
      }

      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.send(buffer);
      return;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        attempts.push(`${candidate.label}: timeout after ${candidate.timeoutMs}ms`);
      } else {
        const message = error instanceof Error ? error.message : 'Unknown error';
        attempts.push(`${candidate.label}: ${message}`);
      }
    }
  }

  res.status(502).send(`FRED upstream request failed. Attempts: ${attempts.join(' | ')}`);
}

app.get('/api/fred/austin-median-listing.csv', async (req, res) => {
  await proxyFredAustinMedianListing(req, res);
});

app.get('/api/coingecko/coins/:coinId/market_chart', async (req, res) => {
  const coinId = String(req.params.coinId || '').trim().toLowerCase();
  const allowedCoins = new Set(['bitcoin', 'ethereum']);
  if (!allowedCoins.has(coinId)) {
    res.status(400).json({ error: 'Unsupported coin id.' });
    return;
  }

  const vsCurrency = typeof req.query.vs_currency === 'string' ? req.query.vs_currency : 'usd';
  const days = typeof req.query.days === 'string' ? req.query.days : '30';
  const interval = typeof req.query.interval === 'string' ? req.query.interval : 'daily';

  const buildUpstreamUrl = (baseUrl) => {
    const url = new URL(`${baseUrl}/coins/${coinId}/market_chart`);
    url.searchParams.set('vs_currency', vsCurrency);
    url.searchParams.set('days', days);
    url.searchParams.set('interval', interval);
    return url;
  };

  const requestFrom = async (baseUrl, authHeaderName) => {
    const headers = { Accept: 'application/json' };
    if (COINGECKO_API_KEY && authHeaderName) {
      headers[authHeaderName] = COINGECKO_API_KEY;
    }

    const upstream = await fetch(buildUpstreamUrl(baseUrl), { headers });
    const payload = await upstream.text();
    return { upstream, payload };
  };

  const shouldRetryWithDemoHost = (payloadText) => {
    if (!payloadText) return false;

    try {
      const parsed = JSON.parse(payloadText);
      const errorCode = Number(parsed?.error_code);
      const errorMessage = String(parsed?.status?.error_message || '').toLowerCase();
      return (
        errorCode === 10011 ||
        errorMessage.includes('change your root url') ||
        errorMessage.includes('demo api key')
      );
    } catch {
      return false;
    }
  };

  try {
    let response;

    if (COINGECKO_API_KEY) {
      response = await requestFrom(COINGECKO_PRO_BASE_URL, 'x-cg-pro-api-key');

      if (shouldRetryWithDemoHost(response.payload)) {
        response = await requestFrom(COINGECKO_PUBLIC_BASE_URL, 'x-cg-demo-api-key');
      }
    } else {
      response = await requestFrom(COINGECKO_PUBLIC_BASE_URL, undefined);
    }

    res.status(response.upstream.status);
    res.setHeader('Content-Type', response.upstream.headers.get('content-type') || 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.send(response.payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(502).json({ error: `CoinGecko upstream request failed: ${message}` });
  }
});

app.use(express.static(DIST_PATH));

app.get('/*', (_req, res) => {
  res.sendFile(path.join(DIST_PATH, 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  if (!COINGECKO_API_KEY) {
    console.warn('COINGECKO_API_KEY is not set. Requests may be rate-limited.');
  }
  console.log(`Server running on port ${PORT}`);
});
