const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/generate-report', async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).send('Please provide a URL as a query parameter.');
  }

  const reportPath = path.join(__dirname, 'lighthouse-report.html');

  exec(`npx lighthouse ${url} --output html --output-path ${reportPath} --quiet`, (error, 
stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).send('Error generating the report.');
    }

    res.sendFile(reportPath);
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

