# Market Visualizer

Interactive market dashboard for comparing Bitcoin, Ethereum, and Austin housing data with configurable time ranges.

## Live Demo
- Production: [https://market-visualization-6d9671c91b62.herokuapp.com](https://market-visualization-6d9671c91b62.herokuapp.com)

## Stack
- Angular 18 (standalone components + signals)
- D3.js (custom responsive SVG chart rendering)
- SCSS theme system (tokenized styles)
- Node.js + Express API layer (`/api/*`)
- Jest + `jest-preset-angular`

## Features
- Multi-asset selector (BTC, ETH, Austin Housing)
- Time-range controls with asset-aware behavior
- CoinGecko-backed crypto pricing
- FRED-backed Austin housing median listing series
- Unified API routing for local and production environments

## Local Development
1. Clone: `git clone https://github.com/clarkmyfancy/market-visualizer.git`
2. Install deps: `npm install`
3. Set CoinGecko key (recommended):
   - `export COINGECKO_API_KEY=your_key_here`
4. Start app + API server: `npm run dev`
5. Open: [http://localhost:4200](http://localhost:4200)

## Scripts
- `npm run dev` - start Angular dev server and Node API server
- `npm test` - run unit tests
- `npm run build` - build Angular app
- `npm run build:prod` - production build
