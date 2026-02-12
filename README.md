Market Visualizer: Austin Tech & Asset Dashboard
A high-performance, responsive data visualization platform built to monitor diverse asset classes, including Crypto, Stocks, and Austin Real Estate. This project serves as a technical showcase of modern Angular 18 architecture and D3.js engine integration.

🚀 The Problem
Modern investors and founders (particularly in the Austin scene) often juggle data across fragmented platforms—Robinhood for crypto, Zillow for real estate, and various brokers for stocks. This dashboard centralizes those metrics into a single, high-fidelity interface that feels as smooth on a mobile device as it does on a desktop workstation.

✨ Key Features
Reactive Market Engine: Built with Angular Signals for instantaneous UI updates without the overhead of traditional change detection.

Custom D3.js Visualization: Hand-crafted SVG charts optimized for performance and "pixel-perfect" precision.

Mobile-First "Scrubbing": Interactive vertical scrub lines and tooltips optimized for touch-events and thumb-navigation.

Data Normalization: A robust TypeScript service layer that translates disparate API schemas into a unified MarketAsset model.

🛠 Tech Stack
Framework: Angular 18 (Standalone Components, Signals)

Visualization: D3.js v7+

Language: TypeScript (Strict Mode)

Styling: SCSS with Modern CSS Variables for "Native-feel" mobile UI

Testing: Jest (Unit) & Playwright (E2E)

🏗 Architecture Overview
The project follows a Senior-level separation of concerns to ensure scalability:

src/app/core/: Centralized services and data-fetching logic.

src/app/shared/: Reusable D3 components and strict TypeScript interfaces.

src/app/features/: High-level dashboard views and layout orchestration.

🚦 Getting Started
Prerequisites

Node.js v20 (LTS)

Angular CLI

Installation

Clone the repository:

Bash
git clone https://github.com/clarkmyfancy/market-visualizer.git
Install dependencies:

Bash
npm install
Launch the development server:

Bash
ng serve
View the app at http://localhost:4200.

🗺 Roadmap
[x] Initial D3 Responsive Container

[ ] Live CoinGecko API Integration

[ ] Austin Real Estate Geographic Heatmap

[ ] Local Storage Persistence for "Pinned" Assets
