const express = require('express');
const path = require('path');
const app = express();

// Point to the 'browser' folder inside your dist directory
// Angular 18+ structure: dist/[project-name]/browser
const appPath = path.join(__dirname, 'dist/market-visualizer/browser');

app.use(express.static(appPath));

app.get('/*', (req, res) => {
    res.sendFile(path.join(appPath, 'index.html'));
});

// Use the port Heroku provides, otherwise default to 8080
const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
