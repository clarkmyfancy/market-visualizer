# Market Visualizer

A responsive market data dashboard built with Angular 18 and D3.js.

## Tech Stack
- Framework: Angular 18 (standalone components + signals)
- Visualization: D3.js (responsive SVG line chart)
- Styling: SCSS with shared theme tokens
- Backend: Node.js + Express API proxy layer
- Testing: Jest + jest-preset-angular

## Local Development
1. Clone the repo: `git clone https://github.com/clarkmyfancy/market-visualizer.git`
2. Install dependencies: `npm install`
3. Set CoinGecko API key (optional but recommended):
   - `export COINGECKO_API_KEY=your_key_here`
4. Run app + API server: `npm run dev` (open `http://localhost:4200`)
5. Run tests: `npm test`
6. Build production bundle: `npm run build:prod`
