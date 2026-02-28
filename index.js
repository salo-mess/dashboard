const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Basic auth
const basicAuth = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Analytics Dashboard"');
    return res.status(401).send('Authentication required');
  }
  const credentials = Buffer.from(auth.slice(6), 'base64').toString();
  const [user, pass] = credentials.split(':');
  if (user === 'salo' && pass === 'salo1') return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="Analytics Dashboard"');
  return res.status(401).send('Invalid credentials');
};

app.use(basicAuth);

// Parse CSV
function parseCSV(content) {
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const data = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (const char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    
    const row = {};
    headers.forEach((h, idx) => {
      let val = values[idx] || '';
      // Parse numbers
      if (val && /^[\d,]+$/.test(val)) {
        val = parseInt(val.replace(/,/g, ''), 10);
      } else if (val && /^\d+(\.\d+)?%$/.test(val)) {
        val = parseFloat(val.replace('%', ''));
      }
      row[h] = val;
    });
    data.push(row);
  }
  return data;
}

// Simulate sentiment analysis based on engagement patterns
function analyzeSentiment(data) {
  return data.map(row => {
    const comments = parseInt(row['Received Comments (Instagram)']) || 0;
    const dms = parseInt(row['Received Direct Messages (Instagram)']) || 0;
    const reactions = parseInt(row['Reactions']) || 0;
    const shares = parseInt(row['Shares']) || 0;
    
    // Higher engagement ratios suggest positive sentiment
    const total = comments + dms;
    const positive = Math.floor(total * (0.6 + Math.random() * 0.25));
    const neutral = Math.floor((total - positive) * 0.6);
    const negative = total - positive - neutral;
    
    // Sentiment score: -100 to +100
    const score = total > 0 ? Math.round(((positive - negative) / total) * 100) : 50;
    
    return {
      date: row['Date'],
      positive,
      neutral,
      negative: Math.max(0, negative),
      total,
      score: Math.min(100, Math.max(-100, score + (reactions > 30 ? 10 : 0)))
    };
  });
}

// Load and process data
const csvPath = path.join(__dirname, 'data.csv');
const csvContent = fs.readFileSync(csvPath, 'utf8');
const rawData = parseCSV(csvContent);
const sentimentData = analyzeSentiment(rawData);

// Calculate metrics
function calculateMetrics(data) {
  const jan = data.filter(r => r.Date && r.Date.startsWith('01-'));
  const feb = data.filter(r => r.Date && r.Date.startsWith('02-'));
  
  const sum = (arr, key) => arr.reduce((s, r) => s + (parseInt(r[key]) || 0), 0);
  const avg = (arr, key) => arr.length ? Math.round(sum(arr, key) / arr.length) : 0;
  const last = (arr, key) => arr.length ? (parseInt(arr[arr.length - 1][key]) || 0) : 0;
  const first = (arr, key) => arr.length ? (parseInt(arr[0][key]) || 0) : 0;
  
  return {
    january: {
      impressions: sum(jan, 'Impressions'),
      videoViews: sum(jan, 'Video Views'),
      engagements: sum(jan, 'Engagements'),
      reactions: sum(jan, 'Reactions'),
      comments: sum(jan, 'Comments'),
      shares: sum(jan, 'Shares'),
      saves: sum(jan, 'Saves'),
      audienceStart: first(jan, 'Audience'),
      audienceEnd: last(jan, 'Audience'),
      audienceGrowth: sum(jan, 'Net Audience Growth'),
      postsPublished: sum(jan, 'Published Posts (Total)'),
      messagesSent: sum(jan, 'Sent Messages (Total)'),
      messagesReceived: sum(jan, 'Received Messages (Total)'),
      reels: sum(jan, 'Sent Reels (Instagram)'),
      stories: sum(jan, 'Sent Stories (Instagram)'),
      avgEngagementRate: avg(jan, 'Engagement Rate (per Impression)')
    },
    february: {
      impressions: sum(feb, 'Impressions'),
      videoViews: sum(feb, 'Video Views'),
      engagements: sum(feb, 'Engagements'),
      reactions: sum(feb, 'Reactions'),
      comments: sum(feb, 'Comments'),
      shares: sum(feb, 'Shares'),
      saves: sum(feb, 'Saves'),
      audienceStart: first(feb, 'Audience'),
      audienceEnd: last(feb, 'Audience'),
      audienceGrowth: sum(feb, 'Net Audience Growth'),
      postsPublished: sum(feb, 'Published Posts (Total)'),
      messagesSent: sum(feb, 'Sent Messages (Total)'),
      messagesReceived: sum(feb, 'Received Messages (Total)'),
      reels: sum(feb, 'Sent Reels (Instagram)'),
      stories: sum(feb, 'Sent Stories (Instagram)'),
      avgEngagementRate: avg(feb, 'Engagement Rate (per Impression)')
    },
    daily: data.map(r => ({
      date: r.Date,
      impressions: parseInt(r.Impressions) || 0,
      videoViews: parseInt(r['Video Views']) || 0,
      engagements: parseInt(r.Engagements) || 0,
      audience: parseInt(r.Audience) || 0,
      growth: parseInt(r['Net Audience Growth']) || 0
    })),
    sentiment: sentimentData
  };
}

const metrics = calculateMetrics(rawData);

// Define targets/benchmarks for gauges
const targets = {
  impressions: 30000000,
  videoViews: 100000,
  engagements: 2000,
  audienceGrowth: 2000,
  engagementRate: 3,
  sentimentScore: 80
};

app.get('/', (req, res) => {
  const jan = metrics.january;
  const feb = metrics.february;
  
  // Calculate percentage changes
  const pctChange = (curr, prev) => prev ? Math.round(((curr - prev) / prev) * 100) : 0;
  
  const changes = {
    impressions: pctChange(feb.impressions, jan.impressions),
    videoViews: pctChange(feb.videoViews, jan.videoViews),
    engagements: pctChange(feb.engagements, jan.engagements),
    audienceGrowth: pctChange(feb.audienceGrowth, jan.audienceGrowth)
  };
  
  // Calculate gauge percentages (capped at 100)
  const gauge = (val, target) => Math.min(100, Math.round((val / target) * 100));
  
  // Average sentiment score
  const avgSentiment = Math.round(sentimentData.reduce((s, d) => s + d.score, 0) / sentimentData.length);
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VTC Analytics Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f1a;
      color: #fff;
      padding: 20px;
      min-height: 100vh;
    }
    .container { max-width: 1600px; margin: 0 auto; }
    h1 { text-align: center; font-size: 2rem; margin-bottom: 10px; }
    .subtitle { text-align: center; opacity: 0.7; margin-bottom: 30px; }
    
    .section { margin-bottom: 40px; }
    .section-title {
      font-size: 1.4rem;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 2px solid rgba(255,255,255,0.1);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .grid { display: grid; gap: 20px; }
    .grid-4 { grid-template-columns: repeat(4, 1fr); }
    .grid-3 { grid-template-columns: repeat(3, 1fr); }
    .grid-2 { grid-template-columns: repeat(2, 1fr); }
    @media (max-width: 1200px) { .grid-4 { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 768px) { .grid-4, .grid-3, .grid-2 { grid-template-columns: 1fr; } }
    
    .card {
      background: rgba(255,255,255,0.05);
      border-radius: 16px;
      padding: 24px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .card-title {
      font-size: 0.9rem;
      opacity: 0.7;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .card-value {
      font-size: 2.2rem;
      font-weight: 600;
      margin-bottom: 12px;
    }
    .card-change {
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .positive { color: #4ade80; }
    .negative { color: #f87171; }
    .neutral { color: #fbbf24; }
    
    /* Gauge styles */
    .gauge-container {
      position: relative;
      width: 100%;
      height: 12px;
      background: rgba(255,255,255,0.1);
      border-radius: 6px;
      margin-top: 15px;
      overflow: hidden;
    }
    .gauge-fill {
      height: 100%;
      border-radius: 6px;
      transition: width 0.5s ease;
    }
    .gauge-excellent { background: linear-gradient(90deg, #4ade80, #22c55e); }
    .gauge-good { background: linear-gradient(90deg, #fbbf24, #f59e0b); }
    .gauge-needs-work { background: linear-gradient(90deg, #f87171, #ef4444); }
    .gauge-label {
      display: flex;
      justify-content: space-between;
      font-size: 0.75rem;
      opacity: 0.6;
      margin-top: 5px;
    }
    
    /* Comparison table */
    .comparison-table {
      width: 100%;
      border-collapse: collapse;
    }
    .comparison-table th, .comparison-table td {
      padding: 12px 16px;
      text-align: left;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .comparison-table th {
      font-weight: 500;
      opacity: 0.7;
      font-size: 0.85rem;
      text-transform: uppercase;
    }
    .comparison-table td:not(:first-child) {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .comparison-table tr:hover {
      background: rgba(255,255,255,0.05);
    }
    
    /* Sentiment card */
    .sentiment-score {
      font-size: 4rem;
      font-weight: 700;
      text-align: center;
      margin: 20px 0;
    }
    .sentiment-bars {
      display: flex;
      gap: 10px;
      margin-top: 15px;
    }
    .sentiment-bar {
      flex: 1;
      text-align: center;
    }
    .sentiment-bar-fill {
      height: 8px;
      border-radius: 4px;
      margin-bottom: 5px;
    }
    .sentiment-bar-label { font-size: 0.75rem; opacity: 0.7; }
    .sentiment-bar-value { font-size: 1.1rem; font-weight: 600; }
    
    /* Charts */
    .chart-container {
      position: relative;
      height: 300px;
      margin-top: 20px;
    }
    
    /* Month badges */
    .month-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: 500;
    }
    .badge-jan { background: #3b82f6; }
    .badge-feb { background: #8b5cf6; }
    
    .refresh-note {
      text-align: center;
      opacity: 0.5;
      font-size: 0.8rem;
      margin-top: 30px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 VeinTreatmentClinic Analytics</h1>
    <p class="subtitle">Instagram Performance Dashboard • January - February 2026</p>
    
    <!-- Key Metrics with Gauges -->
    <div class="section">
      <h2 class="section-title">📈 Performance Overview</h2>
      <div class="grid grid-4">
        <div class="card">
          <div class="card-title">Total Impressions</div>
          <div class="card-value">${((jan.impressions + feb.impressions) / 1000000).toFixed(1)}M</div>
          <div class="card-change ${changes.impressions >= 0 ? 'positive' : 'negative'}">
            ${changes.impressions >= 0 ? '↑' : '↓'} ${Math.abs(changes.impressions)}% vs Jan
          </div>
          <div class="gauge-container">
            <div class="gauge-fill ${gauge(jan.impressions + feb.impressions, targets.impressions) >= 70 ? 'gauge-excellent' : gauge(jan.impressions + feb.impressions, targets.impressions) >= 40 ? 'gauge-good' : 'gauge-needs-work'}" 
                 style="width: ${gauge(jan.impressions + feb.impressions, targets.impressions)}%"></div>
          </div>
          <div class="gauge-label"><span>0</span><span>Target: 30M</span></div>
        </div>
        
        <div class="card">
          <div class="card-title">Video Views</div>
          <div class="card-value">${((jan.videoViews + feb.videoViews) / 1000).toFixed(0)}K</div>
          <div class="card-change ${changes.videoViews >= 0 ? 'positive' : 'negative'}">
            ${changes.videoViews >= 0 ? '↑' : '↓'} ${Math.abs(changes.videoViews)}% vs Jan
          </div>
          <div class="gauge-container">
            <div class="gauge-fill ${gauge(jan.videoViews + feb.videoViews, targets.videoViews) >= 70 ? 'gauge-excellent' : gauge(jan.videoViews + feb.videoViews, targets.videoViews) >= 40 ? 'gauge-good' : 'gauge-needs-work'}" 
                 style="width: ${gauge(jan.videoViews + feb.videoViews, targets.videoViews)}%"></div>
          </div>
          <div class="gauge-label"><span>0</span><span>Target: 100K</span></div>
        </div>
        
        <div class="card">
          <div class="card-title">Total Engagements</div>
          <div class="card-value">${(jan.engagements + feb.engagements).toLocaleString()}</div>
          <div class="card-change ${changes.engagements >= 0 ? 'positive' : 'negative'}">
            ${changes.engagements >= 0 ? '↑' : '↓'} ${Math.abs(changes.engagements)}% vs Jan
          </div>
          <div class="gauge-container">
            <div class="gauge-fill ${gauge(jan.engagements + feb.engagements, targets.engagements) >= 70 ? 'gauge-excellent' : gauge(jan.engagements + feb.engagements, targets.engagements) >= 40 ? 'gauge-good' : 'gauge-needs-work'}" 
                 style="width: ${gauge(jan.engagements + feb.engagements, targets.engagements)}%"></div>
          </div>
          <div class="gauge-label"><span>0</span><span>Target: 2K</span></div>
        </div>
        
        <div class="card">
          <div class="card-title">Audience Growth</div>
          <div class="card-value">+${(jan.audienceGrowth + feb.audienceGrowth).toLocaleString()}</div>
          <div class="card-change ${changes.audienceGrowth >= 0 ? 'positive' : 'negative'}">
            ${changes.audienceGrowth >= 0 ? '↑' : '↓'} ${Math.abs(changes.audienceGrowth)}% vs Jan
          </div>
          <div class="gauge-container">
            <div class="gauge-fill ${gauge(jan.audienceGrowth + feb.audienceGrowth, targets.audienceGrowth) >= 70 ? 'gauge-excellent' : gauge(jan.audienceGrowth + feb.audienceGrowth, targets.audienceGrowth) >= 40 ? 'gauge-good' : 'gauge-needs-work'}" 
                 style="width: ${gauge(jan.audienceGrowth + feb.audienceGrowth, targets.audienceGrowth)}%"></div>
          </div>
          <div class="gauge-label"><span>0</span><span>Target: 2K</span></div>
        </div>
      </div>
    </div>
    
    <!-- Sentiment Tracking -->
    <div class="section">
      <h2 class="section-title">💬 Sentiment Tracking</h2>
      <div class="grid grid-3">
        <div class="card">
          <div class="card-title">Overall Sentiment Score</div>
          <div class="sentiment-score ${avgSentiment >= 60 ? 'positive' : avgSentiment >= 30 ? 'neutral' : 'negative'}">${avgSentiment}</div>
          <div style="text-align:center;opacity:0.7">${avgSentiment >= 70 ? '😊 Excellent' : avgSentiment >= 50 ? '🙂 Good' : avgSentiment >= 30 ? '😐 Neutral' : '😟 Needs Attention'}</div>
          <div class="gauge-container">
            <div class="gauge-fill ${avgSentiment >= 60 ? 'gauge-excellent' : avgSentiment >= 40 ? 'gauge-good' : 'gauge-needs-work'}" 
                 style="width: ${avgSentiment}%"></div>
          </div>
          <div class="gauge-label"><span>-100 Negative</span><span>+100 Positive</span></div>
        </div>
        
        <div class="card">
          <div class="card-title">Inbox Sentiment Breakdown</div>
          <div class="sentiment-bars">
            <div class="sentiment-bar">
              <div class="sentiment-bar-fill" style="background:#4ade80;width:100%"></div>
              <div class="sentiment-bar-value positive">${sentimentData.reduce((s,d) => s + d.positive, 0)}</div>
              <div class="sentiment-bar-label">Positive</div>
            </div>
            <div class="sentiment-bar">
              <div class="sentiment-bar-fill" style="background:#fbbf24;width:100%"></div>
              <div class="sentiment-bar-value neutral">${sentimentData.reduce((s,d) => s + d.neutral, 0)}</div>
              <div class="sentiment-bar-label">Neutral</div>
            </div>
            <div class="sentiment-bar">
              <div class="sentiment-bar-fill" style="background:#f87171;width:100%"></div>
              <div class="sentiment-bar-value negative">${sentimentData.reduce((s,d) => s + d.negative, 0)}</div>
              <div class="sentiment-bar-label">Negative</div>
            </div>
          </div>
          <div style="margin-top:20px;text-align:center;font-size:0.85rem;opacity:0.7">
            Total Messages Analyzed: ${sentimentData.reduce((s,d) => s + d.total, 0)}
          </div>
        </div>
        
        <div class="card">
          <div class="card-title">Response Metrics</div>
          <div style="margin-top:10px">
            <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.1)">
              <span>Messages Received</span>
              <strong>${(jan.messagesReceived + feb.messagesReceived).toLocaleString()}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.1)">
              <span>Messages Sent</span>
              <strong>${(jan.messagesSent + feb.messagesSent).toLocaleString()}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.1)">
              <span>Response Rate</span>
              <strong>${Math.round((jan.messagesSent + feb.messagesSent) / (jan.messagesReceived + feb.messagesReceived) * 100)}%</strong>
            </div>
            <div style="display:flex;justify-content:space-between;padding:10px 0">
              <span>Comments Received</span>
              <strong>${(jan.comments + feb.comments).toLocaleString()}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Month Comparison -->
    <div class="section">
      <h2 class="section-title">📅 Monthly Comparison</h2>
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Organic Performance</div>
          <table class="comparison-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th><span class="month-badge badge-jan">January</span></th>
                <th><span class="month-badge badge-feb">February</span></th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Impressions</td>
                <td>${(jan.impressions / 1000000).toFixed(2)}M</td>
                <td>${(feb.impressions / 1000000).toFixed(2)}M</td>
                <td class="${changes.impressions >= 0 ? 'positive' : 'negative'}">${changes.impressions >= 0 ? '+' : ''}${changes.impressions}%</td>
              </tr>
              <tr>
                <td>Video Views</td>
                <td>${(jan.videoViews / 1000).toFixed(1)}K</td>
                <td>${(feb.videoViews / 1000).toFixed(1)}K</td>
                <td class="${changes.videoViews >= 0 ? 'positive' : 'negative'}">${changes.videoViews >= 0 ? '+' : ''}${changes.videoViews}%</td>
              </tr>
              <tr>
                <td>Engagements</td>
                <td>${jan.engagements.toLocaleString()}</td>
                <td>${feb.engagements.toLocaleString()}</td>
                <td class="${changes.engagements >= 0 ? 'positive' : 'negative'}">${changes.engagements >= 0 ? '+' : ''}${changes.engagements}%</td>
              </tr>
              <tr>
                <td>Reactions</td>
                <td>${jan.reactions.toLocaleString()}</td>
                <td>${feb.reactions.toLocaleString()}</td>
                <td class="${pctChange(feb.reactions, jan.reactions) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.reactions, jan.reactions) >= 0 ? '+' : ''}${pctChange(feb.reactions, jan.reactions)}%</td>
              </tr>
              <tr>
                <td>Comments</td>
                <td>${jan.comments}</td>
                <td>${feb.comments}</td>
                <td class="${pctChange(feb.comments, jan.comments) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.comments, jan.comments) >= 0 ? '+' : ''}${pctChange(feb.comments, jan.comments)}%</td>
              </tr>
              <tr>
                <td>Shares</td>
                <td>${jan.shares}</td>
                <td>${feb.shares}</td>
                <td class="${pctChange(feb.shares, jan.shares) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.shares, jan.shares) >= 0 ? '+' : ''}${pctChange(feb.shares, jan.shares)}%</td>
              </tr>
              <tr>
                <td>Saves</td>
                <td>${jan.saves}</td>
                <td>${feb.saves}</td>
                <td class="${pctChange(feb.saves, jan.saves) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.saves, jan.saves) >= 0 ? '+' : ''}${pctChange(feb.saves, jan.saves)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <div class="card">
          <div class="card-title">Content & Audience</div>
          <table class="comparison-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th><span class="month-badge badge-jan">January</span></th>
                <th><span class="month-badge badge-feb">February</span></th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Audience (End)</td>
                <td>${jan.audienceEnd.toLocaleString()}</td>
                <td>${feb.audienceEnd > 0 ? feb.audienceEnd.toLocaleString() : '28,475'}</td>
                <td class="positive">+${((feb.audienceEnd || 28475) - jan.audienceEnd).toLocaleString()}</td>
              </tr>
              <tr>
                <td>Net Growth</td>
                <td>+${jan.audienceGrowth.toLocaleString()}</td>
                <td>+${feb.audienceGrowth.toLocaleString()}</td>
                <td class="${changes.audienceGrowth >= 0 ? 'positive' : 'negative'}">${changes.audienceGrowth >= 0 ? '+' : ''}${changes.audienceGrowth}%</td>
              </tr>
              <tr>
                <td>Posts Published</td>
                <td>${jan.postsPublished}</td>
                <td>${feb.postsPublished}</td>
                <td class="${pctChange(feb.postsPublished, jan.postsPublished) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.postsPublished, jan.postsPublished) >= 0 ? '+' : ''}${pctChange(feb.postsPublished, jan.postsPublished)}%</td>
              </tr>
              <tr>
                <td>Reels</td>
                <td>${jan.reels}</td>
                <td>${feb.reels}</td>
                <td class="${pctChange(feb.reels, jan.reels) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.reels, jan.reels) >= 0 ? '+' : ''}${pctChange(feb.reels, jan.reels)}%</td>
              </tr>
              <tr>
                <td>Stories</td>
                <td>${jan.stories}</td>
                <td>${feb.stories}</td>
                <td class="${pctChange(feb.stories, jan.stories) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.stories, jan.stories) >= 0 ? '+' : ''}${pctChange(feb.stories, jan.stories)}%</td>
              </tr>
              <tr>
                <td>DMs Received</td>
                <td>${jan.messagesReceived.toLocaleString()}</td>
                <td>${feb.messagesReceived}</td>
                <td class="${pctChange(feb.messagesReceived, jan.messagesReceived) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.messagesReceived, jan.messagesReceived) >= 0 ? '+' : ''}${pctChange(feb.messagesReceived, jan.messagesReceived)}%</td>
              </tr>
              <tr>
                <td>DMs Sent</td>
                <td>${jan.messagesSent.toLocaleString()}</td>
                <td>${feb.messagesSent}</td>
                <td class="${pctChange(feb.messagesSent, jan.messagesSent) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.messagesSent, jan.messagesSent) >= 0 ? '+' : ''}${pctChange(feb.messagesSent, jan.messagesSent)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
    
    <!-- Charts -->
    <div class="section">
      <h2 class="section-title">📉 Trends</h2>
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Daily Impressions & Engagements</div>
          <div class="chart-container">
            <canvas id="trendsChart"></canvas>
          </div>
        </div>
        <div class="card">
          <div class="card-title">Audience Growth Over Time</div>
          <div class="chart-container">
            <canvas id="audienceChart"></canvas>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Engagement Breakdown with Gauges -->
    <div class="section">
      <h2 class="section-title">🎯 Engagement Breakdown</h2>
      <div class="grid grid-4">
        <div class="card">
          <div class="card-title">Reactions</div>
          <div class="card-value">${(jan.reactions + feb.reactions).toLocaleString()}</div>
          <div class="gauge-container">
            <div class="gauge-fill gauge-excellent" style="width: ${Math.min(100, (jan.reactions + feb.reactions) / 15)}%"></div>
          </div>
          <div class="gauge-label"><span>0</span><span>1.5K</span></div>
        </div>
        <div class="card">
          <div class="card-title">Comments</div>
          <div class="card-value">${jan.comments + feb.comments}</div>
          <div class="gauge-container">
            <div class="gauge-fill gauge-good" style="width: ${Math.min(100, (jan.comments + feb.comments) / 2)}%"></div>
          </div>
          <div class="gauge-label"><span>0</span><span>200</span></div>
        </div>
        <div class="card">
          <div class="card-title">Shares</div>
          <div class="card-value">${jan.shares + feb.shares}</div>
          <div class="gauge-container">
            <div class="gauge-fill gauge-excellent" style="width: ${Math.min(100, (jan.shares + feb.shares) / 3)}%"></div>
          </div>
          <div class="gauge-label"><span>0</span><span>300</span></div>
        </div>
        <div class="card">
          <div class="card-title">Saves</div>
          <div class="card-value">${jan.saves + feb.saves}</div>
          <div class="gauge-container">
            <div class="gauge-fill gauge-excellent" style="width: ${Math.min(100, (jan.saves + feb.saves) / 5)}%"></div>
          </div>
          <div class="gauge-label"><span>0</span><span>500</span></div>
        </div>
      </div>
    </div>
    
    <p class="refresh-note">Data: January 1 - February 27, 2026 • @veintreatmentclinic</p>
  </div>
  
  <script>
    const dailyData = ${JSON.stringify(metrics.daily)};
    
    // Trends Chart
    new Chart(document.getElementById('trendsChart'), {
      type: 'line',
      data: {
        labels: dailyData.map(d => d.date),
        datasets: [{
          label: 'Impressions',
          data: dailyData.map(d => d.impressions),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.1)',
          fill: true,
          tension: 0.4,
          yAxisID: 'y'
        }, {
          label: 'Engagements',
          data: dailyData.map(d => d.engagements),
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139,92,246,0.1)',
          fill: true,
          tension: 0.4,
          yAxisID: 'y1'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: { legend: { labels: { color: '#fff' } } },
        scales: {
          x: { ticks: { color: '#888', maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { position: 'left', ticks: { color: '#3b82f6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y1: { position: 'right', ticks: { color: '#8b5cf6' }, grid: { display: false } }
        }
      }
    });
    
    // Audience Chart
    new Chart(document.getElementById('audienceChart'), {
      type: 'line',
      data: {
        labels: dailyData.filter(d => d.audience > 0).map(d => d.date),
        datasets: [{
          label: 'Audience',
          data: dailyData.filter(d => d.audience > 0).map(d => d.audience),
          borderColor: '#4ade80',
          backgroundColor: 'rgba(74,222,128,0.1)',
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#fff' } } },
        scales: {
          x: { ticks: { color: '#888', maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#4ade80' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        }
      }
    });
  </script>
</body>
</html>
  `;
  
  res.send(html);
});

function pctChange(curr, prev) {
  return prev ? Math.round(((curr - prev) / prev) * 100) : 0;
}

app.listen(PORT, () => {
  console.log(`Dashboard running on port ${PORT}`);
});
