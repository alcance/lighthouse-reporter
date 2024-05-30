const express = require('express');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/generate-report', async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).send('Please provide a URL as a query parameter.');
  }

  exec(`lighthouse ${url} --output json --quiet --headless`, (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).send('Error generating the report.');
    }

    try {
      const reportJson = JSON.parse(stdout);
      res.json(reportJson);
    } catch (parseError) {
      console.error('Error parsing JSON:', parseError);
      return res.status(500).send('Error parsing JSON report.');
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
