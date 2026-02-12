# 📈 Market Visualizer

A high-performance, responsive market data dashboard built with **Angular 18** and **D3.js**. This project visualizes market performance across diverse asset classes using reactive signals and custom D3 charting logic.

## 🚀 Live Demo
**[View the Live Application on Heroku](https://market-visualization-6d9671c91b62.herokuapp.com/)**

---

## 🛠️ Tech Stack
* **Framework:** Angular 18 (Standalone Components, Signals)
* **Visualization:** D3.js (Responsive SVG line charts)
* **Styling:** SCSS (Mobile-first, Flexbox/Grid)
* **Testing:** Jest & Angular Testing Library
* **Infrastructure:** Node.js (Express) server on Heroku



## 🏗️ Core Features
* **Reactive State Management:** Leverages Angular Signals for efficient, fine-grained updates without full component re-renders.
* **Responsive D3 Engine:** Custom-built chart logic that recalculates scales and dimensions on window resize for a seamless cross-device experience.
* **Enterprise Architecture:** Clean separation of concerns with dedicated Core (Services), Shared (Models), and Feature (UI) modules.

## 💻 Local Development

1. **Clone the repo:** `git clone https://github.com/clarkmyfancy/market-visualizer.git`

2. **Install dependencies:** `npm install`

3. **Run Dev Server:** `npm run dev` (Access via `http://localhost:4200`)

4. **Run Unit Tests:** `npm test`

5. **Build Production:** `npm run build:prod`

---
*Created by Jack Conrad Clark — Software Engineer in Austin, TX.*
