const express = require('express');
const puppeteer = require('puppeteer');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/generate-report', async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).send('Please provide a URL as a query parameter.');
  }

  try {
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true,
    });

    // Dynamically import lighthouse
    const lighthouse = await import('lighthouse');

    const { lhr } = await lighthouse.default(url, {
      port: (new URL(browser.wsEndpoint())).port,
      output: 'json',
    });

    await browser.close();

    res.json(lhr);
  } catch (error) {
    console.error(`Error generating the report: ${error}`);
    return res.status(500).send('Error generating the report.');
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
