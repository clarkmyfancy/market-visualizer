const express = require('express');
const path = require('path');
const { Readable } = require('stream');

const app = express();

const DIST_PATH = path.join(__dirname, 'dist/market-visualizer');
const REDFIN_BASE_URL =
  'https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker';
const FRED_GRAPH_CSV_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv';

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
