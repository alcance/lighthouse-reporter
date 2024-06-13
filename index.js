const express = require('express');
const puppeteer = require('puppeteer');
const { URL } = require('url');
const { Resend } = require('resend');
const bodyParser = require('body-parser');
const mailchimp = require('@mailchimp/mailchimp_marketing');
const cors = require('cors');
const { Readable } = require('stream');
const PDFDocument = require('pdfkit');
const MemoryStream = require('memorystream'); // A library to handle in-memory streams
const fs = require('fs');

require('dotenv').config();

const PORT = process.env.PORT || 3003;
const app = express();

mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: process.env.MAILCHIMP_SERVER_PREFIX,
});

app.use(bodyParser.json());

const allowedOrigins = ['https://*.systec.dev', 'https://*.vercel.app', 'http://localhost:3000', 'https://www.systec.dev'];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.some(pattern => new RegExp(pattern).test(origin))) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true,
  preflightContinue: true,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

let cachedJsonMap = new Map(); // Use a Map for caching
let requestQueue = []; // Queue to hold requests
let isProcessing = false; // Flag to check if a request is being processed

// Worker function to process the queue
const processQueue = async () => {
  if (isProcessing || requestQueue.length === 0) {
    return;
  }

  isProcessing = true;
  const { req, res } = requestQueue.shift(); // Get the first request from the queue

  const url = req.query.url;

  try {
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true,
    });

    const lighthouse = await import('lighthouse');

    const { lhr } = await lighthouse.default(url, {
      port: (new URL(browser.wsEndpoint())).port,
      output: 'json',
    });

    await browser.close();
    debugger;

    cachedJsonMap.set(url, lhr); // Cache the JSON response for this URL
    console.log('report generated');

    res.json(lhr);
  } catch (error) {
    console.error(`Error generating the report: ${error}`);
    res.status(500).send('Error generating the report.');
  } finally {
    isProcessing = false;
    processQueue(); // Process the next request in the queue
  }
};

app.get('/generate-report', (req, res) => {
  const url = req.query.url;

  console.log('generating express report for', url)

  if (!url) {
    return res.status(400).send('Please provide a URL as a query parameter.');
  }

  // Check if the URL is already cached
  if (cachedJsonMap.has(url)) {
    res.send(cachedJsonMap.get(url));
    return;
  }

  // Add the request to the queue
  requestQueue.push({ req, res });

  // Process the queue if not already processing
  processQueue();
});


app.get('/generate-css-report', async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).send('Please provide a URL as a query parameter.');
  }

  try {
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true,
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' }); // Ensure the page is fully loaded

    const colors = await page.evaluate(() => {
      const styles = Array.from(document.styleSheets);
      const colorSet = new Set();

      const resolveCSSVariable = (value) => {
        // Replace CSS variable with placeholder value
        return value.replace(/var\([^)]+\)/g, '1');
      };

      styles.forEach(styleSheet => {
        try {
          const rules = styleSheet.cssRules || [];
          Array.from(rules).forEach(rule => {
            if (rule.style && rule.style.color) {
              colorSet.add(resolveCSSVariable(rule.style.color));
            }
          });
        } catch (e) {
          // Catch and log any security-related errors when accessing CSS rules
          console.warn('Error accessing stylesheet:', e);
        }
      });

      return Array.from(colorSet);
    });

    await browser.close();
    res.json({ colors });

  } catch (error) {
    console.error(`Error generating the CSS report: ${error}`);
    res.status(500).send('Error generating the CSS report.');
  }
});


app.post('/generate-pdf-report', async (req, res) => {
  const { email, websiteUrl } = req.body;

  console.log(email, websiteUrl);

  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  // Check if the URL is cached
  if (!cachedJsonMap.has(websiteUrl)) {
    return res.status(400).json({ error: 'No cached JSON data available for this URL.' });
  }

  try {
    // Create a new PDF document
    const pdfDoc = new PDFDocument();

    // Create a memory stream to store the PDF content
    const buffers = [];
    pdfDoc.on('data', buffers.push.bind(buffers));
    pdfDoc.on('end', async () => {
      const pdfData = Buffer.concat(buffers);

      // Send the PDF file as an attachment via email
      const resend = new Resend(process.env.RESEND_API_KEY);

      await resend.emails.send({
        from: 'Systec Labs <im@systec.dev>',
        to: email,
        subject: 'Web Audit PDF Report from Systec Labs',
        html: '<p>This is your web audit <strong>report</strong>!</p>',
        attachments: [
          {
            filename: 'report.pdf',
            content: pdfData.toString('base64'),
            contentType: 'application/pdf',
            encoding: 'base64',
          }
        ]
      });

      res.json({ message: 'PDF report sent successfully.' });
    });

    // Add watermark text to each page
    pdfDoc.on('pageAdded', () => {
      pdfDoc.font('Helvetica-Bold').fontSize(15).fillColor('gray').opacity(0.5).text('SYSTEC LABS', 20, 10, { angle: 45 });
    });

    // Add content from the cached JSON in a readable format
    const reportData = cachedJsonMap.get(websiteUrl);

    // Example: Format the report
    pdfDoc.fontSize(16).fillColor('blue').text('Web Audit Report', { align: 'center' });
    pdfDoc.moveDown();

    pdfDoc.fontSize(12).fillColor('black').text(`Website URL: ${websiteUrl}`);
    pdfDoc.moveDown();

    // Helper function to get the score or return "N/A" if undefined
    const getScore = (category) => {
      return category && category.score !== undefined ? category.score * 100 : 'N/A';
    };

    // Add detailed audits with fix instructions

    // Performance Audits
    pdfDoc.fontSize(14).fillColor('green').text('Performance Audits:');
    const performanceAudits = [
      { name: 'First Contentful Paint', value: reportData.audits['first-contentful-paint'], fix: 'Optimize images and CSS delivery.' },
      { name: 'Speed Index', value: reportData.audits['speed-index'], fix: 'Minimize main-thread work and reduce JavaScript execution time.' },
      // Add fix instructions for other performance audits as needed
    ];

    performanceAudits.forEach(audit => {
      if (audit.value && audit.value.displayValue) {
        pdfDoc.fontSize(12).fillColor('black').text(`${audit.name}: ${audit.value.displayValue}`);
        pdfDoc.moveDown();
        pdfDoc.fontSize(10).fillColor('red').text(`Fix: ${audit.fix}`); // Add fix instructions
        pdfDoc.moveDown();
      }
    });

    // Accessibility Audits
    pdfDoc.fontSize(14).fillColor('green').text('Accessibility Audits:');


    const accessibilityAudits = [
      { name: 'Aria Valid', value: reportData.audits['aria-valid'], fix: 'Ensure ARIA attributes are correctly used and valid.' },
      { name: 'Color Contrast', value: reportData.audits['color-contrast'], fix: 'Improve color contrast for better readability.' },
      // Add fix instructions for other accessibility audits as needed
    ];

    accessibilityAudits.forEach(audit => {
      if (audit.value && audit.value.score !== undefined) {
        pdfDoc.fontSize(12).fillColor('black').text(`${audit.name}: ${getScore(audit.value)}`);
        pdfDoc.moveDown();
        pdfDoc.fontSize(10).fillColor('red').text(`Fix: ${audit.fix}`); // Add fix instructions
        pdfDoc.moveDown();
      }
    });

    pdfDoc.end();

  } catch (error) {
    console.error(`Error generating the PDF report: ${error}`);
    res.status(500).json({ error: 'Error generating the PDF report.' });
  }
});

app.post('/subscribe', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    const response = await mailchimp.lists.addListMember(process.env.MAILCHIMP_AUDIENCE_ID, {
      email_address: email,
      status: 'subscribed',
    });

    res.json({ message: 'Subscription successful.' });
  } catch (error) {
    console.error(`Error subscribing email: ${error}`);
    res.status(500).json({ error: 'Error subscribing email.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
