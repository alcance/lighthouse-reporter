const express = require('express');
const puppeteer = require('puppeteer');
const { URL } = require('url');
const { Resend } = require('resend');
const bodyParser = require('body-parser');
const mailchimp = require('@mailchimp/mailchimp_marketing');
require('dotenv').config();
const PORT = process.env.PORT || 3003;
const app = express();

mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: process.env.MAILCHIMP_SERVER_PREFIX,
});

app.use(bodyParser.json());

let cachedJson = {
  // Mock cached JSON data
  title: "Audit Report",
  content: "This is a sample report content."
};

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

    cachedJson = lhr; // Cache the JSON response
    console.log('report generated');

    res.json(lhr);
  } catch (error) {
    console.error(`Error generating the report: ${error}`);
    return res.status(500).send('Error generating the report.');
  }
});

app.post('/generate-pdf-report', async (req, res) => {
  const { email, subscribe } = req.body;

  if (!email) {
    return res.status(400).send('Email is required.');
  }

  if (!cachedJson) {
    return res.status(400).send('No cached JSON data available.');
  }

  try {
    // Convert cached JSON to PDF buffer
    const pdfBuffer = Buffer.from(JSON.stringify(cachedJson));
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: 'Systec Labs <im@systec.dev>',
      to: email,
      subject: 'Web Audit PDF Report from Systec Labs',
      html: '<p>This is your web audit <strong>report</strong>!</p>',
      attachments: [
        {
          filename: 'report.pdf',
          content: pdfBuffer
        }
      ]
    });

    if (subscribe) {
      await fetch('https://lighthouse-reporter-ju9w.onrender.com/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });
    }

    res.send({ message: 'PDF report sent successfully.' });
  } catch (error) {
    console.error(`Error in service sending the PDF report: ${error}`);
    res.status(500).send('Error sending the PDF report.');
  }
});

app.post('/subscribe', async (req, res) => {
  const { email } = req.body;

  console.log('subscribing', email)

  if (!email) {
    return res.status(400).send('Email is required.');
  }

  try {
    const response = await mailchimp.lists.addListMember(process.env.MAILCHIMP_LIST_ID, {
      email_address: email,
      status: 'subscribed',
    });

    res.send({ message: 'Successfully subscribed to Mailchimp.' });
  } catch (error) {
    console.error(`Error subscribing to Mailchimp: ${error}`);
    res.status(500).send('Error subscribing to Mailchimp.');
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
