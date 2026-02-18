const express = require('express');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const app = express();
hydrateEnvFromDotEnv();

const DIST_PATH = path.join(__dirname, 'dist/market-visualizer');
const FRED_GRAPH_CSV_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
const FRED_SERIES_TXT_URL = 'https://fred.stlouisfed.org/data/MEDLISPRI12420.txt';
const COINGECKO_PUBLIC_BASE_URL = 'https://api.coingecko.com/api/v3';
const COINGECKO_DEMO_API_KEY = process.env.COINGECKO_DEMO_API_KEY?.trim() || '';
const COINGECKO_DEMO_MAX_DAYS = parsePositiveInt(process.env.COINGECKO_DEMO_MAX_DAYS, 365);
const COINGECKO_CACHE_TTL_MS = parsePositiveInt(process.env.COINGECKO_CACHE_TTL_MS, 45_000);
const COINGECKO_STALE_TTL_MS = parsePositiveInt(process.env.COINGECKO_STALE_TTL_MS, 15 * 60_000);
const coingeckoResponseCache = new Map();

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

function hydrateEnvFromDotEnv() {
  const candidates = [path.join(__dirname, '.env.local'), path.join(__dirname, '.env')];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;

    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const separator = line.indexOf('=');
      if (separator <= 0) continue;

      const key = line.slice(0, separator).trim();
      if (!key || process.env[key]) continue;

      const rawValue = line.slice(separator + 1).trim();
      const value = rawValue.replace(/^['"]|['"]$/g, '');
      process.env[key] = value;
    }
  }

  hydrateDemoKeyFromZshrc();
}

function hydrateDemoKeyFromZshrc() {
  if (process.env.COINGECKO_DEMO_API_KEY) return;

  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) return;

  const zshrcPath = path.join(home, '.zshrc');
  if (!fs.existsSync(zshrcPath)) return;

  const content = fs.readFileSync(zshrcPath, 'utf8');
  const lines = content.split(/\r?\n/);
  let foundValue = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^(?:export\s+)?COINGECKO_DEMO_API_KEY\s*=\s*(.+)$/);
    if (!match) continue;

    const candidateRaw = match[1].trim();
    const withoutInlineComment = candidateRaw.split(/\s+#/)[0].trim();
    const cleaned = withoutInlineComment.replace(/^['"]|['"]$/g, '').trim();
    if (!cleaned || cleaned.includes('$(') || cleaned.includes('`')) continue;

    foundValue = cleaned;
  }

  if (foundValue) {
    process.env.COINGECKO_DEMO_API_KEY = foundValue;
  }
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

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
  const requestedDays = typeof req.query.days === 'string' ? req.query.days : '30';
  const days = normalizeCoinGeckoDays(requestedDays);
  const interval = typeof req.query.interval === 'string' ? req.query.interval : 'daily';
  const cacheKey = `${coinId}::${vsCurrency}::${days}::${interval}`;
  const now = Date.now();
  const cached = coingeckoResponseCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    res.status(cached.status);
    res.setHeader('Content-Type', cached.contentType || 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.setHeader('X-Cache', 'HIT');
    if (requestedDays !== days) {
      res.setHeader('X-CoinGecko-Days-Requested', requestedDays);
      res.setHeader('X-CoinGecko-Days-Resolved', days);
    }
    res.send(cached.payload);
    return;
  }

  const buildUpstreamUrl = (baseUrl) => {
    const url = new URL(`${baseUrl}/coins/${coinId}/market_chart`);
    url.searchParams.set('vs_currency', vsCurrency);
    url.searchParams.set('days', days);
    url.searchParams.set('interval', interval);
    if (COINGECKO_DEMO_API_KEY) {
      url.searchParams.set('x_cg_demo_api_key', COINGECKO_DEMO_API_KEY);
    }
    return url;
  };

  const requestFrom = async (baseUrl, authHeaderName) => {
    const headers = { Accept: 'application/json' };
    if (COINGECKO_DEMO_API_KEY && authHeaderName) {
      headers[authHeaderName] = COINGECKO_DEMO_API_KEY;
    }

    const upstream = await fetch(buildUpstreamUrl(baseUrl), { headers });
    const payload = await upstream.text();
    return { upstream, payload };
  };

  try {
    const response = await requestFrom(
      COINGECKO_PUBLIC_BASE_URL,
      COINGECKO_DEMO_API_KEY ? 'x-cg-demo-api-key' : undefined
    );

    if (response.upstream.ok) {
      coingeckoResponseCache.set(cacheKey, {
        status: response.upstream.status,
        contentType: response.upstream.headers.get('content-type') || 'application/json',
        payload: response.payload,
        expiresAt: now + COINGECKO_CACHE_TTL_MS,
        staleUntil: now + COINGECKO_STALE_TTL_MS,
      });
    } else if (response.upstream.status === 429 && cached && cached.staleUntil > now) {
      res.status(200);
      res.setHeader('Content-Type', cached.contentType || 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=30');
      res.setHeader('X-Cache', 'STALE');
      if (requestedDays !== days) {
        res.setHeader('X-CoinGecko-Days-Requested', requestedDays);
        res.setHeader('X-CoinGecko-Days-Resolved', days);
      }
      res.send(cached.payload);
      return;
    } else if (cached && cached.staleUntil <= now) {
      coingeckoResponseCache.delete(cacheKey);
    }

    res.status(response.upstream.status);
    res.setHeader('Content-Type', response.upstream.headers.get('content-type') || 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=30');
    if (requestedDays !== days) {
      res.setHeader('X-CoinGecko-Days-Requested', requestedDays);
      res.setHeader('X-CoinGecko-Days-Resolved', days);
    }
    res.send(response.payload);
  } catch (error) {
    if (cached && cached.staleUntil > now) {
      res.status(200);
      res.setHeader('Content-Type', cached.contentType || 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=30');
      res.setHeader('X-Cache', 'STALE');
      if (requestedDays !== days) {
        res.setHeader('X-CoinGecko-Days-Requested', requestedDays);
        res.setHeader('X-CoinGecko-Days-Resolved', days);
      }
      res.send(cached.payload);
      return;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(502).json({ error: `CoinGecko upstream request failed: ${message}` });
  }
});

function normalizeCoinGeckoDays(rawDays) {
  const trimmed = String(rawDays || '').trim().toLowerCase();
  if (!trimmed || trimmed === 'max') {
    return String(COINGECKO_DEMO_MAX_DAYS);
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return '30';
  }

  if (parsed > COINGECKO_DEMO_MAX_DAYS) {
    return String(COINGECKO_DEMO_MAX_DAYS);
  }

  return String(parsed);
}

app.use(express.static(DIST_PATH));

app.get('/*', (_req, res) => {
  res.sendFile(path.join(DIST_PATH, 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  if (!COINGECKO_DEMO_API_KEY) {
    console.warn('COINGECKO_DEMO_API_KEY is not set. Requests may be rate-limited.');
  } else {
    console.log('CoinGecko demo API key detected.');
  }
  console.log(`Server running on port ${PORT}`);
});
