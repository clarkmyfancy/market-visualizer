const express = require('express');
const path = require('path');
const app = express();

// Set this exactly to where your index.html lives
const DIST_PATH = path.join(__dirname, 'dist/market-visualizer');

app.use(express.static(DIST_PATH));

app.get('/*', (req, res) => {
  res.sendFile(path.join(DIST_PATH, 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
