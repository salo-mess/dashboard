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
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const row = [];
    let current = '';
    let inQuotes = false;
    for (let j = 0; j < lines[i].length; j++) {
      const char = lines[i][j];
      if (char === '"') inQuotes = !inQuotes;
      else if (char === ',' && !inQuotes) { row.push(current.trim()); current = ''; }
      else current += char;
    }
    row.push(current.trim());
    result.push(row);
  }
  const headers = result[0];
  const data = [];
  for (let i = 1; i < result.length; i++) {
    const obj = {};
    headers.forEach((h, idx) => {
      let val = result[i][idx] || '';
      if (val && /^[\d,]+$/.test(val)) val = parseInt(val.replace(/,/g, ''), 10);
      else if (val && /^\d+(\.\d+)?%$/.test(val)) val = parseFloat(val.replace('%', ''));
      obj[h] = val;
    });
    data.push(obj);
  }
  return data;
}

// Sentiment keywords
const positiveWords = ['thank', 'thanks', 'love', 'great', 'amazing', 'awesome', 'excellent', 'good', 'best', 'wonderful', 'helpful', 'beautiful', 'happy', '❤️', '💙', '👍', '🙏', '😊', '🥰', 'appreciate', 'perfect'];
const negativeWords = ['bad', 'terrible', 'awful', 'hate', 'worst', 'horrible', 'disappointed', 'angry', 'frustrated', 'complain', 'problem', 'issue', 'pain', 'hurt', 'scam', 'fake', '😡', '😤', '👎'];
const questionWords = ['how', 'what', 'where', 'when', 'why', 'can', 'do you', 'is there', 'does', '?', 'help', 'need'];

function analyzeSentiment(message) {
  const lower = message.toLowerCase();
  let pos = 0, neg = 0, isQ = false;
  positiveWords.forEach(w => { if (lower.includes(w)) pos++; });
  negativeWords.forEach(w => { if (lower.includes(w)) neg++; });
  questionWords.forEach(w => { if (lower.includes(w)) isQ = true; });
  if (pos > neg) return 'positive';
  if (neg > pos) return 'negative';
  if (isQ) return 'inquiry';
  return 'neutral';
}

// Load data
const perfData = parseCSV(fs.readFileSync(path.join(__dirname, 'data.csv'), 'utf8'));
const inboxData = parseCSV(fs.readFileSync(path.join(__dirname, 'inbox.csv'), 'utf8'));

// Process inbox - separate organic vs paid
const processedInbox = inboxData.map(row => {
  const message = row['Message'] || '';
  const msgType = row['Message Type'] || '';
  const isPaid = msgType.toLowerCase().includes('ad');
  return {
    date: row['Timestamp (ET)'] || '',
    type: row['Type'] || '',
    network: row['Network'] || '',
    messageType: msgType,
    message,
    sentiment: analyzeSentiment(message),
    isPaid
  };
});

// Separate organic and paid inbox
const organicInbox = processedInbox.filter(m => !m.isPaid);
const paidInbox = processedInbox.filter(m => m.isPaid);

// Count sentiments
const countSentiments = (arr) => ({
  positive: arr.filter(m => m.sentiment === 'positive').length,
  negative: arr.filter(m => m.sentiment === 'negative').length,
  neutral: arr.filter(m => m.sentiment === 'neutral').length,
  inquiry: arr.filter(m => m.sentiment === 'inquiry').length,
  total: arr.length
});

const organicSentiment = countSentiments(organicInbox);
const paidSentiment = countSentiments(paidInbox);
const totalSentiment = countSentiments(processedInbox);

const calcScore = (s) => s.total > 0 ? Math.round(((s.positive - s.negative) / s.total * 50) + 50) : 50;

// Calculate metrics
function calculateMetrics(data) {
  const jan = data.filter(r => r.Date && r.Date.startsWith('01-'));
  const feb = data.filter(r => r.Date && r.Date.startsWith('02-'));
  const sum = (arr, key) => arr.reduce((s, r) => s + (parseInt(r[key]) || 0), 0);
  const last = (arr, key) => arr.length ? (parseInt(arr[arr.length - 1][key]) || 0) : 0;
  
  const calcMonth = (arr) => ({
    impressions: sum(arr, 'Impressions'),
    videoViews: sum(arr, 'Video Views'),
    engagements: sum(arr, 'Engagements'),
    reactions: sum(arr, 'Reactions'),
    comments: sum(arr, 'Comments'),
    shares: sum(arr, 'Shares'),
    saves: sum(arr, 'Saves'),
    audienceEnd: last(arr, 'Audience') || 28475,
    audienceGrowth: sum(arr, 'Net Audience Growth'),
    postsPublished: sum(arr, 'Published Posts (Total)'),
    messagesSent: sum(arr, 'Sent Messages (Total)'),
    messagesReceived: sum(arr, 'Received Messages (Total)'),
    reels: sum(arr, 'Sent Reels (Instagram)'),
    stories: sum(arr, 'Sent Stories (Instagram)'),
    // Paid metrics
    adPosts: sum(arr, 'Sent Ad Posts (Facebook)'),
    adCommentsSent: sum(arr, 'Sent Ad Comments (Facebook)') + sum(arr, 'Sent Ad Comments (Instagram)'),
    adCommentsReceived: sum(arr, 'Received Ad Comments (Facebook)') + sum(arr, 'Received Ad Comments (Instagram)')
  });
  
  return {
    january: calcMonth(jan),
    february: calcMonth(feb),
    daily: data.map(r => ({
      date: r.Date,
      impressions: parseInt(r.Impressions) || 0,
      videoViews: parseInt(r['Video Views']) || 0,
      engagements: parseInt(r.Engagements) || 0,
      audience: parseInt(r.Audience) || 0
    }))
  };
}

const metrics = calculateMetrics(perfData);
const jan = metrics.january;
const feb = metrics.february;

const pctChange = (curr, prev) => prev ? Math.round(((curr - prev) / prev) * 100) : 0;
const gauge = (val, target) => Math.min(100, Math.round((val / target) * 100));

app.get('/', (req, res) => {
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
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f1a; color: #fff; padding: 20px; min-height: 100vh; }
    .container { max-width: 1600px; margin: 0 auto; }
    h1 { text-align: center; font-size: 2rem; margin-bottom: 10px; }
    .subtitle { text-align: center; opacity: 0.7; margin-bottom: 30px; }
    .section { margin-bottom: 40px; }
    .section-title { font-size: 1.4rem; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid rgba(255,255,255,0.1); display: flex; align-items: center; gap: 10px; }
    .grid { display: grid; gap: 20px; }
    .grid-4 { grid-template-columns: repeat(4, 1fr); }
    .grid-3 { grid-template-columns: repeat(3, 1fr); }
    .grid-2 { grid-template-columns: repeat(2, 1fr); }
    @media (max-width: 1200px) { .grid-4 { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 768px) { .grid-4, .grid-3, .grid-2 { grid-template-columns: 1fr; } }
    .card { background: rgba(255,255,255,0.05); border-radius: 16px; padding: 24px; border: 1px solid rgba(255,255,255,0.1); }
    .card-organic { border-left: 4px solid #4ade80; }
    .card-paid { border-left: 4px solid #f59e0b; }
    .card-title { font-size: 0.9rem; opacity: 0.7; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .card-value { font-size: 2.2rem; font-weight: 600; margin-bottom: 12px; }
    .card-change { font-size: 0.9rem; display: flex; align-items: center; gap: 5px; }
    .positive { color: #4ade80; }
    .negative { color: #f87171; }
    .neutral { color: #fbbf24; }
    .inquiry { color: #60a5fa; }
    .gauge-container { position: relative; width: 100%; height: 12px; background: rgba(255,255,255,0.1); border-radius: 6px; margin-top: 15px; overflow: hidden; }
    .gauge-fill { height: 100%; border-radius: 6px; }
    .gauge-green { background: linear-gradient(90deg, #4ade80, #22c55e); }
    .gauge-orange { background: linear-gradient(90deg, #fbbf24, #f59e0b); }
    .gauge-red { background: linear-gradient(90deg, #f87171, #ef4444); }
    .gauge-label { display: flex; justify-content: space-between; font-size: 0.75rem; opacity: 0.6; margin-top: 5px; }
    .tab-container { display: flex; gap: 10px; margin-bottom: 20px; }
    .tab { padding: 10px 20px; border-radius: 10px; cursor: pointer; font-weight: 500; transition: all 0.2s; }
    .tab-organic { background: rgba(74, 222, 128, 0.2); color: #4ade80; }
    .tab-organic.active { background: #4ade80; color: #000; }
    .tab-paid { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
    .tab-paid.active { background: #f59e0b; color: #000; }
    .comparison-table { width: 100%; border-collapse: collapse; }
    .comparison-table th, .comparison-table td { padding: 12px 16px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .comparison-table th { font-weight: 500; opacity: 0.7; font-size: 0.85rem; text-transform: uppercase; }
    .comparison-table td:not(:first-child) { text-align: right; }
    .sentiment-score { font-size: 3rem; font-weight: 700; text-align: center; margin: 15px 0; }
    .sentiment-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 15px; }
    .sentiment-item { text-align: center; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 10px; }
    .sentiment-count { font-size: 1.5rem; font-weight: 600; }
    .sentiment-label { font-size: 0.75rem; opacity: 0.7; margin-top: 3px; }
    .message-list { max-height: 300px; overflow-y: auto; }
    .message-item { padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; gap: 12px; align-items: flex-start; }
    .message-badge { padding: 3px 8px; border-radius: 12px; font-size: 0.7rem; font-weight: 500; }
    .badge-positive { background: rgba(74, 222, 128, 0.2); color: #4ade80; }
    .badge-negative { background: rgba(248, 113, 113, 0.2); color: #f87171; }
    .badge-neutral { background: rgba(251, 191, 36, 0.2); color: #fbbf24; }
    .badge-inquiry { background: rgba(96, 165, 250, 0.2); color: #60a5fa; }
    .badge-organic { background: rgba(74, 222, 128, 0.2); color: #4ade80; }
    .badge-paid { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
    .message-text { font-size: 0.85rem; line-height: 1.4; flex: 1; }
    .chart-container { position: relative; height: 280px; margin-top: 15px; }
    .month-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 500; }
    .badge-jan { background: #3b82f6; }
    .badge-feb { background: #8b5cf6; }
    .divider { display: flex; align-items: center; gap: 15px; margin: 30px 0; }
    .divider-line { flex: 1; height: 1px; background: rgba(255,255,255,0.1); }
    .divider-text { font-size: 0.9rem; opacity: 0.7; text-transform: uppercase; letter-spacing: 1px; }
    .refresh-note { text-align: center; opacity: 0.5; font-size: 0.8rem; margin-top: 30px; }
    .type-label { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; margin-left: 10px; }
    .type-organic { background: #4ade80; color: #000; }
    .type-paid { background: #f59e0b; color: #000; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 VeinTreatmentClinic Analytics</h1>
    <p class="subtitle">Instagram Performance Dashboard • January - February 2026</p>
    
    <!-- ORGANIC SECTION -->
    <div class="divider">
      <div class="divider-line"></div>
      <div class="divider-text">🌱 Organic Performance</div>
      <div class="divider-line"></div>
    </div>
    
    <div class="section">
      <div class="grid grid-4">
        <div class="card card-organic">
          <div class="card-title">Organic Impressions</div>
          <div class="card-value">${((jan.impressions + feb.impressions) / 1000000).toFixed(1)}M</div>
          <div class="card-change ${pctChange(feb.impressions, jan.impressions) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.impressions, jan.impressions) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.impressions, jan.impressions))}% vs Jan</div>
          <div class="gauge-container"><div class="gauge-fill gauge-green" style="width: ${gauge(jan.impressions + feb.impressions, 30000000)}%"></div></div>
          <div class="gauge-label"><span>0</span><span>30M</span></div>
        </div>
        <div class="card card-organic">
          <div class="card-title">Video Views</div>
          <div class="card-value">${((jan.videoViews + feb.videoViews) / 1000).toFixed(0)}K</div>
          <div class="card-change ${pctChange(feb.videoViews, jan.videoViews) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.videoViews, jan.videoViews) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.videoViews, jan.videoViews))}% vs Jan</div>
          <div class="gauge-container"><div class="gauge-fill gauge-green" style="width: ${gauge(jan.videoViews + feb.videoViews, 100000)}%"></div></div>
          <div class="gauge-label"><span>0</span><span>100K</span></div>
        </div>
        <div class="card card-organic">
          <div class="card-title">Engagements</div>
          <div class="card-value">${(jan.engagements + feb.engagements).toLocaleString()}</div>
          <div class="card-change ${pctChange(feb.engagements, jan.engagements) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.engagements, jan.engagements) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.engagements, jan.engagements))}% vs Jan</div>
          <div class="gauge-container"><div class="gauge-fill gauge-green" style="width: ${gauge(jan.engagements + feb.engagements, 2000)}%"></div></div>
          <div class="gauge-label"><span>0</span><span>2K</span></div>
        </div>
        <div class="card card-organic">
          <div class="card-title">Audience Growth</div>
          <div class="card-value">+${(jan.audienceGrowth + feb.audienceGrowth).toLocaleString()}</div>
          <div class="card-change ${pctChange(feb.audienceGrowth, jan.audienceGrowth) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.audienceGrowth, jan.audienceGrowth) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.audienceGrowth, jan.audienceGrowth))}% vs Jan</div>
          <div class="gauge-container"><div class="gauge-fill gauge-green" style="width: ${gauge(jan.audienceGrowth + feb.audienceGrowth, 2000)}%"></div></div>
          <div class="gauge-label"><span>0</span><span>2K</span></div>
        </div>
      </div>
    </div>
    
    <!-- Organic Sentiment -->
    <div class="section">
      <h2 class="section-title">💬 Organic Inbox Sentiment <span class="type-label type-organic">ORGANIC</span></h2>
      <div class="grid grid-2">
        <div class="card card-organic">
          <div class="card-title">Organic Sentiment Score (${organicSentiment.total} messages)</div>
          <div class="sentiment-score positive">${calcScore(organicSentiment)}</div>
          <div class="gauge-container"><div class="gauge-fill gauge-green" style="width: ${calcScore(organicSentiment)}%"></div></div>
          <div class="sentiment-grid">
            <div class="sentiment-item"><div class="sentiment-count positive">${organicSentiment.positive}</div><div class="sentiment-label">Positive</div></div>
            <div class="sentiment-item"><div class="sentiment-count neutral">${organicSentiment.neutral}</div><div class="sentiment-label">Neutral</div></div>
            <div class="sentiment-item"><div class="sentiment-count negative">${organicSentiment.negative}</div><div class="sentiment-label">Negative</div></div>
            <div class="sentiment-item"><div class="sentiment-count inquiry">${organicSentiment.inquiry}</div><div class="sentiment-label">Inquiries</div></div>
          </div>
        </div>
        <div class="card card-organic">
          <div class="card-title">Recent Organic Messages</div>
          <div class="message-list">
            ${organicInbox.slice(0, 6).map(m => `
              <div class="message-item">
                <span class="message-badge badge-${m.sentiment}">${m.sentiment}</span>
                <span class="message-text">${m.message.length > 80 ? m.message.substring(0, 80) + '...' : m.message || '(empty)'}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
    
    <!-- PAID SECTION -->
    <div class="divider">
      <div class="divider-line"></div>
      <div class="divider-text">💰 Paid Performance</div>
      <div class="divider-line"></div>
    </div>
    
    <div class="section">
      <div class="grid grid-4">
        <div class="card card-paid">
          <div class="card-title">Ad Comments Received</div>
          <div class="card-value">${(jan.adCommentsReceived + feb.adCommentsReceived).toLocaleString()}</div>
          <div class="card-change ${pctChange(feb.adCommentsReceived, jan.adCommentsReceived) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.adCommentsReceived, jan.adCommentsReceived) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.adCommentsReceived, jan.adCommentsReceived))}% vs Jan</div>
          <div class="gauge-container"><div class="gauge-fill gauge-orange" style="width: ${Math.min(100, (jan.adCommentsReceived + feb.adCommentsReceived) / 2)}%"></div></div>
        </div>
        <div class="card card-paid">
          <div class="card-title">Paid Inbox Messages</div>
          <div class="card-value">${paidSentiment.total}</div>
          <div style="opacity:0.7;font-size:0.9rem">Ad Comments & DMs</div>
          <div class="gauge-container"><div class="gauge-fill gauge-orange" style="width: ${Math.min(100, paidSentiment.total * 3)}%"></div></div>
        </div>
        <div class="card card-paid">
          <div class="card-title">Paid Sentiment Score</div>
          <div class="card-value">${calcScore(paidSentiment)}</div>
          <div style="opacity:0.7;font-size:0.9rem">${calcScore(paidSentiment) >= 60 ? '😊 Positive' : calcScore(paidSentiment) >= 40 ? '😐 Neutral' : '😟 Negative'}</div>
          <div class="gauge-container"><div class="gauge-fill ${calcScore(paidSentiment) >= 50 ? 'gauge-orange' : 'gauge-red'}" style="width: ${calcScore(paidSentiment)}%"></div></div>
        </div>
        <div class="card card-paid">
          <div class="card-title">Paid Inquiries</div>
          <div class="card-value">${paidSentiment.inquiry}</div>
          <div style="opacity:0.7;font-size:0.9rem">Potential Leads</div>
          <div class="gauge-container"><div class="gauge-fill gauge-orange" style="width: ${Math.min(100, paidSentiment.inquiry * 10)}%"></div></div>
        </div>
      </div>
    </div>
    
    <!-- Paid Sentiment -->
    <div class="section">
      <h2 class="section-title">💬 Paid Inbox Sentiment <span class="type-label type-paid">PAID</span></h2>
      <div class="grid grid-2">
        <div class="card card-paid">
          <div class="card-title">Paid Sentiment Breakdown (${paidSentiment.total} messages)</div>
          <div class="sentiment-score" style="color:#f59e0b">${calcScore(paidSentiment)}</div>
          <div class="gauge-container"><div class="gauge-fill gauge-orange" style="width: ${calcScore(paidSentiment)}%"></div></div>
          <div class="sentiment-grid">
            <div class="sentiment-item"><div class="sentiment-count positive">${paidSentiment.positive}</div><div class="sentiment-label">Positive</div></div>
            <div class="sentiment-item"><div class="sentiment-count neutral">${paidSentiment.neutral}</div><div class="sentiment-label">Neutral</div></div>
            <div class="sentiment-item"><div class="sentiment-count negative">${paidSentiment.negative}</div><div class="sentiment-label">Negative</div></div>
            <div class="sentiment-item"><div class="sentiment-count inquiry">${paidSentiment.inquiry}</div><div class="sentiment-label">Inquiries</div></div>
          </div>
        </div>
        <div class="card card-paid">
          <div class="card-title">Recent Paid/Ad Messages</div>
          <div class="message-list">
            ${paidInbox.slice(0, 6).map(m => `
              <div class="message-item">
                <span class="message-badge badge-${m.sentiment}">${m.sentiment}</span>
                <span class="message-text">${m.message.length > 80 ? m.message.substring(0, 80) + '...' : m.message || '(empty)'}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
    
    <!-- COMPARISON SECTION -->
    <div class="divider">
      <div class="divider-line"></div>
      <div class="divider-text">📅 Monthly Comparison</div>
      <div class="divider-line"></div>
    </div>
    
    <div class="section">
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Organic Performance <span class="type-label type-organic">ORGANIC</span></div>
          <table class="comparison-table">
            <thead><tr><th>Metric</th><th><span class="month-badge badge-jan">Jan</span></th><th><span class="month-badge badge-feb">Feb</span></th><th>Δ</th></tr></thead>
            <tbody>
              <tr><td>Impressions</td><td>${(jan.impressions/1e6).toFixed(2)}M</td><td>${(feb.impressions/1e6).toFixed(2)}M</td><td class="${pctChange(feb.impressions, jan.impressions) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.impressions, jan.impressions) >= 0 ? '+' : ''}${pctChange(feb.impressions, jan.impressions)}%</td></tr>
              <tr><td>Video Views</td><td>${(jan.videoViews/1e3).toFixed(1)}K</td><td>${(feb.videoViews/1e3).toFixed(1)}K</td><td class="${pctChange(feb.videoViews, jan.videoViews) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.videoViews, jan.videoViews) >= 0 ? '+' : ''}${pctChange(feb.videoViews, jan.videoViews)}%</td></tr>
              <tr><td>Engagements</td><td>${jan.engagements}</td><td>${feb.engagements}</td><td class="${pctChange(feb.engagements, jan.engagements) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.engagements, jan.engagements) >= 0 ? '+' : ''}${pctChange(feb.engagements, jan.engagements)}%</td></tr>
              <tr><td>Reactions</td><td>${jan.reactions}</td><td>${feb.reactions}</td><td class="${pctChange(feb.reactions, jan.reactions) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.reactions, jan.reactions) >= 0 ? '+' : ''}${pctChange(feb.reactions, jan.reactions)}%</td></tr>
              <tr><td>Comments</td><td>${jan.comments}</td><td>${feb.comments}</td><td class="${pctChange(feb.comments, jan.comments) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.comments, jan.comments) >= 0 ? '+' : ''}${pctChange(feb.comments, jan.comments)}%</td></tr>
              <tr><td>Shares</td><td>${jan.shares}</td><td>${feb.shares}</td><td class="${pctChange(feb.shares, jan.shares) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.shares, jan.shares) >= 0 ? '+' : ''}${pctChange(feb.shares, jan.shares)}%</td></tr>
              <tr><td>Audience Growth</td><td>+${jan.audienceGrowth}</td><td>+${feb.audienceGrowth}</td><td class="${pctChange(feb.audienceGrowth, jan.audienceGrowth) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.audienceGrowth, jan.audienceGrowth) >= 0 ? '+' : ''}${pctChange(feb.audienceGrowth, jan.audienceGrowth)}%</td></tr>
            </tbody>
          </table>
        </div>
        <div class="card">
          <div class="card-title">Paid/Ad Metrics <span class="type-label type-paid">PAID</span></div>
          <table class="comparison-table">
            <thead><tr><th>Metric</th><th><span class="month-badge badge-jan">Jan</span></th><th><span class="month-badge badge-feb">Feb</span></th><th>Δ</th></tr></thead>
            <tbody>
              <tr><td>Ad Comments Recv</td><td>${jan.adCommentsReceived}</td><td>${feb.adCommentsReceived}</td><td class="${pctChange(feb.adCommentsReceived, jan.adCommentsReceived) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.adCommentsReceived, jan.adCommentsReceived) >= 0 ? '+' : ''}${pctChange(feb.adCommentsReceived, jan.adCommentsReceived)}%</td></tr>
              <tr><td>Ad Posts</td><td>${jan.adPosts}</td><td>${feb.adPosts}</td><td>-</td></tr>
              <tr><td>DMs Received</td><td>${jan.messagesReceived}</td><td>${feb.messagesReceived}</td><td class="${pctChange(feb.messagesReceived, jan.messagesReceived) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.messagesReceived, jan.messagesReceived) >= 0 ? '+' : ''}${pctChange(feb.messagesReceived, jan.messagesReceived)}%</td></tr>
              <tr><td>DMs Sent</td><td>${jan.messagesSent}</td><td>${feb.messagesSent}</td><td class="${pctChange(feb.messagesSent, jan.messagesSent) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.messagesSent, jan.messagesSent) >= 0 ? '+' : ''}${pctChange(feb.messagesSent, jan.messagesSent)}%</td></tr>
            </tbody>
          </table>
          <div style="margin-top:20px;padding:15px;background:rgba(245,158,11,0.1);border-radius:10px">
            <div style="font-size:0.85rem;opacity:0.8">💡 Paid inbox messages show ${paidSentiment.inquiry} inquiries - potential leads from ad campaigns</div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Charts -->
    <div class="section">
      <h2 class="section-title">📉 Trends</h2>
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Daily Impressions & Engagements</div>
          <div class="chart-container"><canvas id="trendsChart"></canvas></div>
        </div>
        <div class="card">
          <div class="card-title">Audience Growth</div>
          <div class="chart-container"><canvas id="audienceChart"></canvas></div>
        </div>
      </div>
    </div>
    
    <!-- Engagement Breakdown -->
    <div class="section">
      <h2 class="section-title">🎯 Engagement Breakdown</h2>
      <div class="grid grid-4">
        <div class="card"><div class="card-title">Reactions</div><div class="card-value">${(jan.reactions + feb.reactions).toLocaleString()}</div><div class="gauge-container"><div class="gauge-fill gauge-green" style="width: ${Math.min(100, (jan.reactions + feb.reactions) / 15)}%"></div></div></div>
        <div class="card"><div class="card-title">Comments</div><div class="card-value">${jan.comments + feb.comments}</div><div class="gauge-container"><div class="gauge-fill gauge-green" style="width: ${Math.min(100, (jan.comments + feb.comments) / 2)}%"></div></div></div>
        <div class="card"><div class="card-title">Shares</div><div class="card-value">${jan.shares + feb.shares}</div><div class="gauge-container"><div class="gauge-fill gauge-green" style="width: ${Math.min(100, (jan.shares + feb.shares) / 3)}%"></div></div></div>
        <div class="card"><div class="card-title">Saves</div><div class="card-value">${jan.saves + feb.saves}</div><div class="gauge-container"><div class="gauge-fill gauge-green" style="width: ${Math.min(100, (jan.saves + feb.saves) / 5)}%"></div></div></div>
      </div>
    </div>
    
    <p class="refresh-note">Data: Jan 1 - Feb 27, 2026 • @veintreatmentclinic • Organic: ${organicSentiment.total} msgs | Paid: ${paidSentiment.total} msgs</p>
  </div>
  
  <script>
    const dailyData = ${JSON.stringify(metrics.daily)};
    new Chart(document.getElementById('trendsChart'), {
      type: 'line', data: { labels: dailyData.map(d => d.date), datasets: [{ label: 'Impressions', data: dailyData.map(d => d.impressions), borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.1)', fill: true, tension: 0.4, yAxisID: 'y' }, { label: 'Engagements', data: dailyData.map(d => d.engagements), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', fill: true, tension: 0.4, yAxisID: 'y1' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#fff' } } }, scales: { x: { ticks: { color: '#888', maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,0.05)' } }, y: { position: 'left', ticks: { color: '#4ade80' }, grid: { color: 'rgba(255,255,255,0.05)' } }, y1: { position: 'right', ticks: { color: '#f59e0b' }, grid: { display: false } } } }
    });
    new Chart(document.getElementById('audienceChart'), {
      type: 'line', data: { labels: dailyData.filter(d => d.audience > 0).map(d => d.date), datasets: [{ label: 'Audience', data: dailyData.filter(d => d.audience > 0).map(d => d.audience), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#fff' } } }, scales: { x: { ticks: { color: '#888', maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,0.05)' } }, y: { ticks: { color: '#3b82f6' }, grid: { color: 'rgba(255,255,255,0.05)' } } } }
    });
  </script>
</body>
</html>`;
  res.send(html);
});

app.listen(PORT, () => console.log(`Dashboard running on port ${PORT}`));
