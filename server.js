const express = require('express');
const path = require('path');
const { Readable } = require('stream');

const app = express();

const DIST_PATH = path.join(__dirname, 'dist/market-visualizer');
const REDFIN_BASE_URL =
  'https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker';
const FRED_GRAPH_CSV_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
const COINGECKO_PRO_BASE_URL = 'https://pro-api.coingecko.com/api/v3';
const COINGECKO_PUBLIC_BASE_URL = 'https://api.coingecko.com/api/v3';
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || 'CG-8WjPCEtCRsev3NWYCvcAPBfL';

app.use('/api', (_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

async function proxyRedfinFile(res, filename) {
  try {
    const upstream = await fetch(`${REDFIN_BASE_URL}/${filename}`);

    if (!upstream.ok) {
      res.status(upstream.status).send(`Redfin upstream request failed (${upstream.status}).`);
      return;
    }

    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    if (upstream.body) {
      Readable.fromWeb(upstream.body).pipe(res);
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(502).send(`Redfin upstream request failed: ${message}`);
  }
}

async function proxyFredAustinMedianListing(req, res) {
  const cosd = typeof req.query.cosd === 'string' ? req.query.cosd : '';
  const coed = typeof req.query.coed === 'string' ? req.query.coed : '';

  const upstreamUrl = new URL(FRED_GRAPH_CSV_URL);
  upstreamUrl.searchParams.set('id', 'MEDLISPRI12420');
  if (cosd) upstreamUrl.searchParams.set('cosd', cosd);
  if (coed) upstreamUrl.searchParams.set('coed', coed);

  try {
    const upstream = await fetch(upstreamUrl);
    if (!upstream.ok) {
      res.status(upstream.status).send(`FRED upstream request failed (${upstream.status}).`);
      return;
    }

    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=1800');

    if (upstream.body) {
      Readable.fromWeb(upstream.body).pipe(res);
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(502).send(`FRED upstream request failed: ${message}`);
  }
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
    if (COINGECKO_API_KEY) {
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
    let { upstream, payload } = await requestFrom(COINGECKO_PRO_BASE_URL, 'x-cg-pro-api-key');

    if (shouldRetryWithDemoHost(payload)) {
      ({ upstream, payload } = await requestFrom(COINGECKO_PUBLIC_BASE_URL, 'x-cg-demo-api-key'));
    }

    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.send(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(502).json({ error: `CoinGecko upstream request failed: ${message}` });
  }
});

app.get('/api/redfin/city-market-tracker.gz', async (_req, res) => {
  await proxyRedfinFile(res, 'city_market_tracker.tsv000.gz');
});

app.get('/api/redfin/metro-market-tracker.gz', async (_req, res) => {
  await proxyRedfinFile(res, 'redfin_metro_market_tracker.tsv000.gz');
});

app.use(express.static(DIST_PATH));

app.get('/*', (_req, res) => {
  res.sendFile(path.join(DIST_PATH, 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
