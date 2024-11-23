const express = require('express');
const puppeteer = require('puppeteer');
const { URL } = require('url');
const { Resend } = require('resend');
const bodyParser = require('body-parser');
const mailchimp = require('@mailchimp/mailchimp_marketing');
const cors = require('cors');
const { jsPDF } = require('jspdf');
require('jspdf-autotable');  // Required for tables
const { format } = require('date-fns');
const fs = require('fs');

require('dotenv').config();

const PORT = process.env.PORT || 3003;
const app = express();

mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: process.env.MAILCHIMP_SERVER_PREFIX,
});

app.use(bodyParser.json());

const allowedOrigins = ['https://*.systec.dev', 'https://*.vercel.app', 'http://localhost:3000', 'https://www.systec.dev', 'http://localhost:3001'];

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
app.options('*', cors(corsOptions));

let cachedJsonMap = new Map();
let requestQueue = [];
let isProcessing = false;

const formatScore = (score) => {
  if (score === undefined || score === null) return 'N/A';
  const percentage = Math.round(score * 100);
  return `${percentage}%`;
};

const getScoreColor = (score) => {
  if (score === undefined || score === null) return [100, 116, 139];  // gray
  const percentage = score * 100;
  if (percentage >= 90) return [34, 197, 94];     // green
  if (percentage >= 50) return [249, 115, 22];    // orange
  return [239, 68, 68];                           // red
};

const getCriticalItems = (reportData, category) => {
  return (reportData?.categories?.[category]?.auditRefs || [])
    .map((item) => ({
      id: item.id,
      title: reportData.audits[item.id]?.title,
      score: reportData.audits[item.id]?.score,
    }))
    .filter(item => !item.score || item.score < 0.9)
    .sort((a, b) => {
      if (a.score === b.score) return 0;
      if (a.score === null || a.score === 0) return -1;
      if (b.score === null || b.score === 0) return 1;
      return a.score - b.score;
    });
};
const addPageWatermark = (doc) => {
  const watermarkText = 'SYSTEC LABS';
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.saveGraphicsState();
  doc.setGState(new doc.GState({ opacity: 0.1 }));
  doc.setFontSize(60);
  doc.setTextColor(200, 200, 200);

  // Center position
  const textWidth = doc.getTextDimensions(watermarkText).w;
  const x = pageWidth / 2 - textWidth / 2;
  const y = pageHeight / 2;

  // Rotate text at center
  doc.text(watermarkText, x, y, {
    angle: 45,
    align: 'center'
  });

  doc.restoreGraphicsState();
};

// Add this helper function for header
const addPageHeader = (doc) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  
  // Add header border
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.5);
  doc.line(10, 15, pageWidth - 10, 15);
  
  // Add logo text
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text('SYSTEC LABS', 14, 12);
  
  // Add page info on right
  doc.text('Web Audit Report', pageWidth - 14, 12, { align: 'right' });
};

// Add this helper function for the website info table
const addWebsiteInfoTable = (doc, websiteUrl, reportData) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  
  // Get general website info from report data
  const mainMetrics = {
    totalBytes: reportData.audits['total-byte-weight']?.displayValue || 'N/A',
    serverResponseTime: reportData.audits['server-response-time']?.displayValue || 'N/A',
    userAgent: reportData.environment?.hostUserAgent || 'N/A',
    timestamp: format(new Date(reportData.fetchTime), 'MMM dd, yyyy HH:mm:ss'),
    device: reportData.configSettings?.formFactor || 'desktop',
    networkThrottle: reportData.configSettings?.throttling?.rttMs + 'ms' || 'N/A'
  };

  doc.autoTable({
    startY: 25,
    theme: 'plain',
    headStyles: {
      fillColor: [240, 245, 250],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
      fontSize: 9
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [71, 85, 105]
    },
    columnStyles: {
      0: { cellWidth: 40 },
      1: { cellWidth: 'auto' }
    },
    head: [['Website Information', '']],
    body: [
      ['URL', websiteUrl],
      ['Scan Date', mainMetrics.timestamp],
      ['Total Size', mainMetrics.totalBytes],
      ['Response Time', mainMetrics.serverResponseTime],
      ['Device', mainMetrics.device],
      ['Network', mainMetrics.networkThrottle]
    ],
    margin: { left: 14, right: 14 },
    styles: {
      overflow: 'linebreak',
      cellWidth: 'wrap',
      cellPadding: 2
    }
  });

  return doc.lastAutoTable.finalY + 10; // Return the Y position after the table
};



const processQueue = async () => {
  if (isProcessing || requestQueue.length === 0) return;

  isProcessing = true;
  const { req, res } = requestQueue.shift();
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
    cachedJsonMap.set(url, lhr);
    fs.writeFileSync('report.json', JSON.stringify(lhr));
    res.json(lhr);
  } catch (error) {
    console.error(`Error generating the report: ${error}`);
    res.status(500).send('Error generating the report.');
  } finally {
    isProcessing = false;
    processQueue();
  }
};

app.get('/generate-report', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Please provide a URL as a query parameter.');
  if (cachedJsonMap.has(url)) return res.send(cachedJsonMap.get(url));
  requestQueue.push({ req, res });
  processQueue();
});

app.get('/generate-css-report', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Please provide a URL as a query parameter.');

  try {
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true,
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });

    const colors = await page.evaluate(() => {
      const styles = Array.from(document.styleSheets);
      const colorSet = new Set();
      const resolveCSSVariable = (value) => value.replace(/var\([^)]+\)/g, '1');
      styles.forEach(styleSheet => {
        try {
          Array.from(styleSheet.cssRules || []).forEach(rule => {
            if (rule.style?.color) colorSet.add(resolveCSSVariable(rule.style.color));
          });
        } catch (e) {
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
  
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  if (!cachedJsonMap.has(websiteUrl)) return res.status(400).json({ error: 'No cached JSON data available for this URL.' });

  try {
    const reportData = cachedJsonMap.get(websiteUrl);
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // Add header
    addPageHeader(doc);

    // Website Info Table
    const mainMetrics = {
      totalBytes: reportData.audits['total-byte-weight']?.displayValue || 'N/A',
      serverResponseTime: reportData.audits['server-response-time']?.displayValue || 'N/A',
      timestamp: format(new Date(reportData.fetchTime), 'MMM dd, yyyy HH:mm:ss'),
      device: reportData.configSettings?.formFactor || 'desktop',
      networkThrottle: reportData.configSettings?.throttling?.rttMs + 'ms' || 'N/A'
    };

    doc.autoTable({
      startY: 25,
      theme: 'plain',
      headStyles: {
        fillColor: [240, 245, 250],
        textColor: [15, 23, 42],
        fontStyle: 'bold',
        fontSize: 9
      },
      bodyStyles: {
        fontSize: 8,
        textColor: [71, 85, 105]
      },
      columnStyles: {
        0: { cellWidth: 40 },
        1: { cellWidth: 'auto' }
      },
      head: [['Website Information', '']],
      body: [
        ['URL', websiteUrl],
        ['Scan Date', mainMetrics.timestamp],
        ['Total Size', mainMetrics.totalBytes],
        ['Response Time', mainMetrics.serverResponseTime],
        ['Device', mainMetrics.device],
        ['Network', mainMetrics.networkThrottle]
      ],
      margin: { left: 14, right: 14 },
      styles: {
        overflow: 'linebreak',
        cellWidth: 'wrap',
        cellPadding: 2
      }
    });

    const startY = doc.lastAutoTable.finalY + 10;

    // Score Summary Table
    const scoreHeaders = [['Category', 'Score', 'Status']];
    const scoreRows = Object.entries(reportData.categories)
      .map(([key, value]) => [
        key.charAt(0).toUpperCase() + key.slice(1),
        formatScore(value.score),
        value.score >= 0.9 ? 'Good' : value.score >= 0.5 ? 'Needs Improvement' : 'Poor'
      ]);

    doc.autoTable({
      head: scoreHeaders,
      body: scoreRows,
      startY: startY,
      theme: 'grid',
      headStyles: {
        fillColor: [248, 250, 252],
        textColor: [15, 23, 42],
        fontStyle: 'bold',
        fontSize: 9
      },
      bodyStyles: {
        fontSize: 8
      },
      styles: {
        overflow: 'linebreak',
        cellWidth: 'wrap'
      },
      columnStyles: {
        0: { cellWidth: 50 },
        1: { cellWidth: 30 },
        2: { cellWidth: 40 }
      },
      margin: { left: 14, right: 14 }
    });

    // Critical Issues by Category
    const categories = ['performance', 'accessibility', 'best-practices', 'seo'];
    let yPos = doc.lastAutoTable.finalY + 10;

    for (const category of categories) {
      const criticalItems = getCriticalItems(reportData, category);
      if (criticalItems.length > 0) {
        if (yPos > doc.internal.pageSize.getHeight() - 40) {
          doc.addPage();
          yPos = 20;
        }

        doc.setFontSize(12);
        doc.setTextColor(15, 23, 42);
        doc.text(`${category.charAt(0).toUpperCase() + category.slice(1)} Issues`, 14, yPos);

        const issueHeaders = [['Issue', 'Score']];
        const issueRows = criticalItems.map(item => [
          item.title,
          formatScore(item.score)
        ]);

        doc.autoTable({
          head: issueHeaders,
          body: issueRows,
          startY: yPos + 5,
          theme: 'grid',
          headStyles: {
            fillColor: [248, 250, 252],
            textColor: [15, 23, 42],
            fontStyle: 'bold',
            fontSize: 9
          },
          bodyStyles: {
            fontSize: 8
          },
          styles: {
            overflow: 'linebreak',
            cellWidth: 'wrap'
          },
          columnStyles: {
            0: { cellWidth: 140 },
            1: { cellWidth: 30 }
          },
          margin: { left: 14, right: 14 },
          didDrawPage: (data) => {
            yPos = data.cursor.y + 10;
          }
        });
      }
    }

    // Performance Metrics
    doc.addPage();
    yPos = 20;
    
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text('Performance Metrics', 14, yPos);

    const metrics = [
      { key: 'first-contentful-paint', label: 'First Contentful Paint' },
      { key: 'speed-index', label: 'Speed Index' },
      { key: 'largest-contentful-paint', label: 'Largest Contentful Paint' },
      { key: 'interactive', label: 'Time to Interactive' },
      { key: 'total-blocking-time', label: 'Total Blocking Time' },
      { key: 'cumulative-layout-shift', label: 'Cumulative Layout Shift' }
    ];

    const metricHeaders = [['Metric', 'Value', 'Score']];
    const metricRows = metrics.map(metric => {
      const audit = reportData.audits[metric.key];
      return [
        metric.label,
        audit.displayValue || 'N/A',
        formatScore(audit.score)
      ];
    });

    doc.autoTable({
      head: metricHeaders,
      body: metricRows,
      startY: yPos + 10,
      theme: 'grid',
      headStyles: {
        fillColor: [248, 250, 252],
        textColor: [15, 23, 42],
        fontStyle: 'bold',
        fontSize: 9
      },
      bodyStyles: {
        fontSize: 8
      },
      styles: {
        overflow: 'linebreak',
        cellWidth: 'wrap'
      },
      columnStyles: {
        0: { cellWidth: 70 },
        1: { cellWidth: 50 },
        2: { cellWidth: 30 }
      },
      margin: { left: 14, right: 14 }
    });

    // Summary Table
    const totalIssues = categories.reduce((acc, category) => 
      acc + getCriticalItems(reportData, category).length, 0
    );

    const summaryHeaders = [['Category', 'Details']];
    const summaryRows = [
      ['Total Issues', `${totalIssues} issues found`],
      ['Priority Areas', categories.map(c => 
        `${c.charAt(0).toUpperCase() + c.slice(1)}: ${getCriticalItems(reportData, c).length} issues`
      ).join('\n')],
      ['Actions', 'Review performance issues\nAddress accessibility\nImplement SEO improvements']
    ];

    doc.autoTable({
      head: summaryHeaders,
      body: summaryRows,
      startY: doc.lastAutoTable.finalY + 20,
      theme: 'grid',
      headStyles: {
        fillColor: [248, 250, 252],
        textColor: [15, 23, 42],
        fontStyle: 'bold',
        fontSize: 9
      },
      bodyStyles: {
        fontSize: 8
      },
      styles: {
        overflow: 'linebreak',
        cellWidth: 'wrap'
      },
      columnStyles: {
        0: { cellWidth: 50 },
        1: { cellWidth: 100 }
      },
      margin: { left: 14, right: 14 }
    });

    // Add watermark and header to each page
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      if (i > 1) addPageHeader(doc);
      addPageWatermark(doc);
    }

    // Convert to buffer and send email
    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
    
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Systec Labs <im@systec.dev>',
      to: email,
      subject: 'Web Audit Report from Systec Labs',
      html: `
        <h1>Your Web Audit Report is Ready!</h1>
        <p>Thank you for using Systec Labs' Web Audit tool. Your comprehensive performance report for ${websiteUrl} is attached.</p>
        <p>Key findings:</p>
        <ul>
          <li>${totalIssues} issues identified</li>
          <li>Primary focus areas: Performance, Accessibility, SEO</li>
          <li>Detailed recommendations included in the report</li>
        </ul>
        <p>Need help implementing these recommendations? Contact our team!</p>
      `,
      attachments: [{
        filename: `web-audit-report-${format(new Date(), 'yyyy-MM-dd')}.pdf`,
        content: pdfBuffer.toString('base64'),
        contentType: 'application/pdf',
        encoding: 'base64',
      }]
    });

    res.json({ message: 'PDF report sent successfully.' });

  } catch (error) {
    console.error(`Error generating the PDF report: ${error}`);
    res.status(500).json({ error: 'Error generating the PDF report.' });
  }
});

app.post('/subscribe', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  try {
    await mailchimp.lists.addListMember(process.env.MAILCHIMP_AUDIENCE_ID, {
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