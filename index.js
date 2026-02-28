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
const negativeWords = ['bad', 'terrible', 'awful', 'hate', 'worst', 'horrible', 'disappointed', 'angry', 'frustrated', 'complain', 'problem', 'issue', 'scam', 'fake', '😡', '😤', '👎'];
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

// Process inbox
const processedInbox = inboxData.map(row => {
  const message = row['Message'] || '';
  const msgType = row['Message Type'] || '';
  const isPaid = msgType.toLowerCase().includes('ad');
  return { date: row['Timestamp (ET)'] || '', network: row['Network'] || '', messageType: msgType, message, sentiment: analyzeSentiment(message), isPaid };
});

const organicInbox = processedInbox.filter(m => !m.isPaid);
const paidInbox = processedInbox.filter(m => m.isPaid);

const countSentiments = (arr) => ({
  positive: arr.filter(m => m.sentiment === 'positive').length,
  negative: arr.filter(m => m.sentiment === 'negative').length,
  neutral: arr.filter(m => m.sentiment === 'neutral').length,
  inquiry: arr.filter(m => m.sentiment === 'inquiry').length,
  total: arr.length
});

const organicSentiment = countSentiments(organicInbox);
const paidSentiment = countSentiments(paidInbox);
const calcScore = (s) => s.total > 0 ? Math.round(((s.positive - s.negative) / s.total * 50) + 50) : 50;

// Calculate metrics
function calculateMetrics(data) {
  const jan = data.filter(r => r.Date && r.Date.startsWith('01-'));
  const feb = data.filter(r => r.Date && r.Date.startsWith('02-'));
  const sum = (arr, key) => arr.reduce((s, r) => s + (parseInt(r[key]) || 0), 0);
  const avg = (arr, key) => {
    const vals = arr.map(r => parseFloat(r[key]) || 0).filter(v => v > 0);
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  };
  const last = (arr, key) => arr.length ? (parseInt(arr[arr.length - 1][key]) || 0) : 0;
  
  const calcMonth = (arr) => ({
    impressions: sum(arr, 'Impressions'),
    videoViews: sum(arr, 'Video Views'),
    engagements: sum(arr, 'Engagements'),
    reactions: sum(arr, 'Reactions'),
    comments: sum(arr, 'Comments'),
    shares: sum(arr, 'Shares'),
    saves: sum(arr, 'Saves'),
    postClicks: sum(arr, 'Post Link Clicks'),
    otherClicks: sum(arr, 'Other Post Clicks'),
    audienceEnd: last(arr, 'Audience') || 28475,
    audienceGrowth: sum(arr, 'Net Audience Growth'),
    postsPublished: sum(arr, 'Published Posts (Total)'),
    messagesSent: sum(arr, 'Sent Messages (Total)'),
    messagesReceived: sum(arr, 'Received Messages (Total)'),
    reels: sum(arr, 'Sent Reels (Instagram)'),
    stories: sum(arr, 'Sent Stories (Instagram)'),
    igPosts: sum(arr, 'Sent Posts (Instagram)'),
    adPosts: sum(arr, 'Sent Ad Posts (Facebook)'),
    adCommentsReceived: sum(arr, 'Received Ad Comments (Facebook)') + sum(arr, 'Received Ad Comments (Instagram)'),
    engagementRate: avg(arr, 'Engagement Rate (per Impression)')
  });
  
  return {
    january: calcMonth(jan),
    february: calcMonth(feb),
    daily: data.map(r => ({
      date: r.Date,
      impressions: parseInt(r.Impressions) || 0,
      videoViews: parseInt(r['Video Views']) || 0,
      engagements: parseInt(r.Engagements) || 0,
      audience: parseInt(r.Audience) || 0,
      engagementRate: parseFloat(r['Engagement Rate (per Impression)']) || 0
    }))
  };
}

const metrics = calculateMetrics(perfData);
const jan = metrics.january;
const feb = metrics.february;

const pctChange = (curr, prev) => prev ? Math.round(((curr - prev) / prev) * 100) : 0;
const gauge = (val, target) => Math.min(100, Math.round((val / target) * 100));

// Calculate content performance
const totalPosts = jan.postsPublished + feb.postsPublished;
const totalReels = jan.reels + feb.reels;
const totalStories = jan.stories + feb.stories;
const totalContent = totalPosts + totalReels + totalStories;
const avgEngRate = ((jan.engagementRate + feb.engagementRate) / 2).toFixed(3);
const videoPerPost = totalContent > 0 ? Math.round((jan.videoViews + feb.videoViews) / totalContent) : 0;

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
    .section-title { font-size: 1.3rem; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid rgba(255,255,255,0.1); }
    .grid { display: grid; gap: 20px; }
    .grid-5 { grid-template-columns: repeat(5, 1fr); }
    .grid-4 { grid-template-columns: repeat(4, 1fr); }
    .grid-3 { grid-template-columns: repeat(3, 1fr); }
    .grid-2 { grid-template-columns: repeat(2, 1fr); }
    @media (max-width: 1400px) { .grid-5 { grid-template-columns: repeat(3, 1fr); } }
    @media (max-width: 1200px) { .grid-4, .grid-5 { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 768px) { .grid-4, .grid-3, .grid-2, .grid-5 { grid-template-columns: 1fr; } }
    .card { background: rgba(255,255,255,0.05); border-radius: 16px; padding: 20px; border: 1px solid rgba(255,255,255,0.1); }
    .card-organic { border-left: 4px solid #4ade80; }
    .card-paid { border-left: 4px solid #f59e0b; }
    .card-content { border-left: 4px solid #8b5cf6; }
    .card-title { font-size: 0.85rem; opacity: 0.7; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .card-value { font-size: 2rem; font-weight: 600; margin-bottom: 8px; }
    .card-change { font-size: 0.85rem; display: flex; align-items: center; gap: 5px; }
    .positive { color: #4ade80; }
    .negative { color: #f87171; }
    .neutral { color: #fbbf24; }
    .inquiry { color: #60a5fa; }
    .gauge-container { position: relative; width: 100%; height: 10px; background: rgba(255,255,255,0.1); border-radius: 5px; margin-top: 12px; overflow: hidden; }
    .gauge-fill { height: 100%; border-radius: 5px; }
    .gauge-green { background: linear-gradient(90deg, #4ade80, #22c55e); }
    .gauge-orange { background: linear-gradient(90deg, #fbbf24, #f59e0b); }
    .gauge-purple { background: linear-gradient(90deg, #a78bfa, #8b5cf6); }
    .gauge-blue { background: linear-gradient(90deg, #60a5fa, #3b82f6); }
    .gauge-label { display: flex; justify-content: space-between; font-size: 0.7rem; opacity: 0.5; margin-top: 4px; }
    .comparison-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    .comparison-table th, .comparison-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .comparison-table th { font-weight: 500; opacity: 0.7; font-size: 0.8rem; text-transform: uppercase; }
    .comparison-table td:not(:first-child) { text-align: right; }
    .sentiment-score { font-size: 2.5rem; font-weight: 700; text-align: center; margin: 10px 0; }
    .sentiment-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px; }
    .sentiment-item { text-align: center; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px; }
    .sentiment-count { font-size: 1.3rem; font-weight: 600; }
    .sentiment-label { font-size: 0.7rem; opacity: 0.7; margin-top: 2px; }
    .message-list { max-height: 250px; overflow-y: auto; }
    .message-item { padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; gap: 10px; align-items: flex-start; }
    .message-badge { padding: 2px 6px; border-radius: 10px; font-size: 0.65rem; font-weight: 500; }
    .badge-positive { background: rgba(74, 222, 128, 0.2); color: #4ade80; }
    .badge-negative { background: rgba(248, 113, 113, 0.2); color: #f87171; }
    .badge-neutral { background: rgba(251, 191, 36, 0.2); color: #fbbf24; }
    .badge-inquiry { background: rgba(96, 165, 250, 0.2); color: #60a5fa; }
    .message-text { font-size: 0.8rem; line-height: 1.3; flex: 1; }
    .chart-container { position: relative; height: 250px; margin-top: 15px; }
    .month-badge { display: inline-block; padding: 3px 10px; border-radius: 15px; font-size: 0.75rem; font-weight: 500; }
    .badge-jan { background: #3b82f6; }
    .badge-feb { background: #8b5cf6; }
    .divider { display: flex; align-items: center; gap: 15px; margin: 30px 0; }
    .divider-line { flex: 1; height: 1px; background: rgba(255,255,255,0.1); }
    .divider-text { font-size: 0.85rem; opacity: 0.7; text-transform: uppercase; letter-spacing: 1px; }
    .refresh-note { text-align: center; opacity: 0.5; font-size: 0.75rem; margin-top: 30px; }
    .type-label { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.65rem; font-weight: 600; margin-left: 8px; }
    .type-organic { background: #4ade80; color: #000; }
    .type-paid { background: #f59e0b; color: #000; }
    .type-content { background: #8b5cf6; color: #fff; }
    .stat-highlight { background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.3); padding: 15px; border-radius: 12px; text-align: center; }
    .stat-big { font-size: 2.5rem; font-weight: 700; color: #a78bfa; }
    .stat-label { font-size: 0.8rem; opacity: 0.7; margin-top: 5px; }
    .demo-placeholder { background: rgba(255,255,255,0.03); border: 2px dashed rgba(255,255,255,0.1); border-radius: 12px; padding: 30px; text-align: center; }
    .demo-placeholder-icon { font-size: 2rem; margin-bottom: 10px; }
    .demo-placeholder-text { opacity: 0.5; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 VeinTreatmentClinic Analytics</h1>
    <p class="subtitle">Instagram Performance Dashboard • January - February 2026</p>
    
    <!-- CONTENT PERFORMANCE -->
    <div class="divider">
      <div class="divider-line"></div>
      <div class="divider-text">🎬 Content Performance</div>
      <div class="divider-line"></div>
    </div>
    
    <div class="section">
      <div class="grid grid-5">
        <div class="card card-content">
          <div class="card-title">Posts Published</div>
          <div class="card-value">${totalPosts}</div>
          <div class="card-change">${pctChange(feb.postsPublished, jan.postsPublished) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.postsPublished, jan.postsPublished))}% vs Jan</div>
          <div class="gauge-container"><div class="gauge-fill gauge-purple" style="width: ${Math.min(100, totalPosts * 2)}%"></div></div>
        </div>
        <div class="card card-content">
          <div class="card-title">Reels</div>
          <div class="card-value">${totalReels}</div>
          <div class="card-change">${pctChange(feb.reels, jan.reels) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.reels, jan.reels))}% vs Jan</div>
          <div class="gauge-container"><div class="gauge-fill gauge-purple" style="width: ${Math.min(100, totalReels)}%"></div></div>
        </div>
        <div class="card card-content">
          <div class="card-title">Stories</div>
          <div class="card-value">${totalStories}</div>
          <div class="card-change">${pctChange(feb.stories, jan.stories) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.stories, jan.stories))}% vs Jan</div>
          <div class="gauge-container"><div class="gauge-fill gauge-purple" style="width: ${Math.min(100, totalStories / 2)}%"></div></div>
        </div>
        <div class="card card-content">
          <div class="card-title">Video Views</div>
          <div class="card-value">${((jan.videoViews + feb.videoViews) / 1000).toFixed(0)}K</div>
          <div class="card-change">${pctChange(feb.videoViews, jan.videoViews) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.videoViews, jan.videoViews))}% vs Jan</div>
          <div class="gauge-container"><div class="gauge-fill gauge-purple" style="width: ${gauge(jan.videoViews + feb.videoViews, 100000)}%"></div></div>
        </div>
        <div class="card card-content">
          <div class="card-title">Post Link Clicks</div>
          <div class="card-value">${jan.postClicks + feb.postClicks}</div>
          <div class="card-change">${pctChange(feb.postClicks, jan.postClicks) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.postClicks, jan.postClicks))}% vs Jan</div>
          <div class="gauge-container"><div class="gauge-fill gauge-purple" style="width: ${Math.min(100, (jan.postClicks + feb.postClicks) / 5)}%"></div></div>
        </div>
      </div>
    </div>
    
    <!-- ENGAGEMENT RATE -->
    <div class="section">
      <h2 class="section-title">📈 Engagement Rate</h2>
      <div class="grid grid-3">
        <div class="card">
          <div class="stat-highlight">
            <div class="stat-big">${avgEngRate}%</div>
            <div class="stat-label">Average Engagement Rate</div>
          </div>
          <div class="gauge-container"><div class="gauge-fill gauge-blue" style="width: ${Math.min(100, parseFloat(avgEngRate) * 20)}%"></div></div>
          <div class="gauge-label"><span>0%</span><span>Industry avg: 1-3%</span></div>
        </div>
        <div class="card">
          <div class="card-title">Engagement Rate Comparison</div>
          <table class="comparison-table">
            <tr><td>January</td><td>${jan.engagementRate.toFixed(3)}%</td></tr>
            <tr><td>February</td><td>${feb.engagementRate.toFixed(3)}%</td></tr>
            <tr><td>Change</td><td class="${pctChange(feb.engagementRate, jan.engagementRate) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.engagementRate, jan.engagementRate) >= 0 ? '+' : ''}${pctChange(feb.engagementRate, jan.engagementRate)}%</td></tr>
          </table>
        </div>
        <div class="card">
          <div class="card-title">Engagement per Content Piece</div>
          <div style="margin-top:15px">
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1)">
              <span>Avg Views/Content</span><strong>${videoPerPost.toLocaleString()}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1)">
              <span>Avg Engagements/Day</span><strong>${Math.round((jan.engagements + feb.engagements) / 58)}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 0">
              <span>Saves/Post</span><strong>${totalPosts > 0 ? ((jan.saves + feb.saves) / totalPosts).toFixed(1) : 0}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- AUDIENCE DEMOGRAPHICS PLACEHOLDER -->
    <div class="section">
      <h2 class="section-title">👥 Audience Demographics & Watch Time</h2>
      <div class="grid grid-2">
        <div class="card">
          <div class="demo-placeholder">
            <div class="demo-placeholder-icon">📊</div>
            <div class="demo-placeholder-text">Demographics data not available in current export.<br>Send Meta Business Suite demographics export to enable.</div>
          </div>
        </div>
        <div class="card">
          <div class="demo-placeholder">
            <div class="demo-placeholder-icon">⏱️</div>
            <div class="demo-placeholder-text">Average watch time not available in current export.<br>Send Instagram Insights export to enable.</div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- ORGANIC SECTION -->
    <div class="divider">
      <div class="divider-line"></div>
      <div class="divider-text">🌱 Organic Performance</div>
      <div class="divider-line"></div>
    </div>
    
    <div class="section">
      <div class="grid grid-4">
        <div class="card card-organic">
          <div class="card-title">Impressions</div>
          <div class="card-value">${((jan.impressions + feb.impressions) / 1000000).toFixed(1)}M</div>
          <div class="card-change ${pctChange(feb.impressions, jan.impressions) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.impressions, jan.impressions) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.impressions, jan.impressions))}%</div>
          <div class="gauge-container"><div class="gauge-fill gauge-green" style="width: ${gauge(jan.impressions + feb.impressions, 30000000)}%"></div></div>
        </div>
        <div class="card card-organic">
          <div class="card-title">Total Engagements</div>
          <div class="card-value">${(jan.engagements + feb.engagements).toLocaleString()}</div>
          <div class="card-change ${pctChange(feb.engagements, jan.engagements) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.engagements, jan.engagements) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.engagements, jan.engagements))}%</div>
          <div class="gauge-container"><div class="gauge-fill gauge-green" style="width: ${gauge(jan.engagements + feb.engagements, 2000)}%"></div></div>
        </div>
        <div class="card card-organic">
          <div class="card-title">Audience Growth</div>
          <div class="card-value">+${(jan.audienceGrowth + feb.audienceGrowth).toLocaleString()}</div>
          <div class="card-change ${pctChange(feb.audienceGrowth, jan.audienceGrowth) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.audienceGrowth, jan.audienceGrowth) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.audienceGrowth, jan.audienceGrowth))}%</div>
          <div class="gauge-container"><div class="gauge-fill gauge-green" style="width: ${gauge(jan.audienceGrowth + feb.audienceGrowth, 2000)}%"></div></div>
        </div>
        <div class="card card-organic">
          <div class="card-title">Organic Sentiment</div>
          <div class="card-value">${calcScore(organicSentiment)}</div>
          <div style="opacity:0.7;font-size:0.8rem">${organicSentiment.total} messages</div>
          <div class="gauge-container"><div class="gauge-fill gauge-green" style="width: ${calcScore(organicSentiment)}%"></div></div>
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
          <div class="card-title">Ad Comments</div>
          <div class="card-value">${(jan.adCommentsReceived + feb.adCommentsReceived).toLocaleString()}</div>
          <div class="card-change ${pctChange(feb.adCommentsReceived, jan.adCommentsReceived) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.adCommentsReceived, jan.adCommentsReceived) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.adCommentsReceived, jan.adCommentsReceived))}%</div>
          <div class="gauge-container"><div class="gauge-fill gauge-orange" style="width: ${Math.min(100, (jan.adCommentsReceived + feb.adCommentsReceived) / 2)}%"></div></div>
        </div>
        <div class="card card-paid">
          <div class="card-title">Paid Messages</div>
          <div class="card-value">${paidSentiment.total}</div>
          <div style="opacity:0.7;font-size:0.8rem">from ads</div>
          <div class="gauge-container"><div class="gauge-fill gauge-orange" style="width: ${Math.min(100, paidSentiment.total * 3)}%"></div></div>
        </div>
        <div class="card card-paid">
          <div class="card-title">Paid Sentiment</div>
          <div class="card-value">${calcScore(paidSentiment)}</div>
          <div style="opacity:0.7;font-size:0.8rem">${calcScore(paidSentiment) >= 60 ? '😊 Positive' : '😐 Neutral'}</div>
          <div class="gauge-container"><div class="gauge-fill gauge-orange" style="width: ${calcScore(paidSentiment)}%"></div></div>
        </div>
        <div class="card card-paid">
          <div class="card-title">Paid Inquiries</div>
          <div class="card-value">${paidSentiment.inquiry}</div>
          <div style="opacity:0.7;font-size:0.8rem">potential leads</div>
          <div class="gauge-container"><div class="gauge-fill gauge-orange" style="width: ${Math.min(100, paidSentiment.inquiry * 10)}%"></div></div>
        </div>
      </div>
    </div>
    
    <!-- MONTHLY COMPARISON -->
    <div class="divider">
      <div class="divider-line"></div>
      <div class="divider-text">📅 Monthly Comparison</div>
      <div class="divider-line"></div>
    </div>
    
    <div class="section">
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Organic Metrics <span class="type-label type-organic">ORGANIC</span></div>
          <table class="comparison-table">
            <thead><tr><th>Metric</th><th><span class="month-badge badge-jan">Jan</span></th><th><span class="month-badge badge-feb">Feb</span></th><th>Δ</th></tr></thead>
            <tbody>
              <tr><td>Impressions</td><td>${(jan.impressions/1e6).toFixed(2)}M</td><td>${(feb.impressions/1e6).toFixed(2)}M</td><td class="${pctChange(feb.impressions, jan.impressions) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.impressions, jan.impressions) >= 0 ? '+' : ''}${pctChange(feb.impressions, jan.impressions)}%</td></tr>
              <tr><td>Video Views</td><td>${(jan.videoViews/1e3).toFixed(1)}K</td><td>${(feb.videoViews/1e3).toFixed(1)}K</td><td class="${pctChange(feb.videoViews, jan.videoViews) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.videoViews, jan.videoViews) >= 0 ? '+' : ''}${pctChange(feb.videoViews, jan.videoViews)}%</td></tr>
              <tr><td>Engagements</td><td>${jan.engagements}</td><td>${feb.engagements}</td><td class="${pctChange(feb.engagements, jan.engagements) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.engagements, jan.engagements) >= 0 ? '+' : ''}${pctChange(feb.engagements, jan.engagements)}%</td></tr>
              <tr><td>Engagement Rate</td><td>${jan.engagementRate.toFixed(2)}%</td><td>${feb.engagementRate.toFixed(2)}%</td><td class="${pctChange(feb.engagementRate, jan.engagementRate) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.engagementRate, jan.engagementRate) >= 0 ? '+' : ''}${pctChange(feb.engagementRate, jan.engagementRate)}%</td></tr>
              <tr><td>Reactions</td><td>${jan.reactions}</td><td>${feb.reactions}</td><td class="${pctChange(feb.reactions, jan.reactions) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.reactions, jan.reactions) >= 0 ? '+' : ''}${pctChange(feb.reactions, jan.reactions)}%</td></tr>
              <tr><td>Audience Growth</td><td>+${jan.audienceGrowth}</td><td>+${feb.audienceGrowth}</td><td class="${pctChange(feb.audienceGrowth, jan.audienceGrowth) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.audienceGrowth, jan.audienceGrowth) >= 0 ? '+' : ''}${pctChange(feb.audienceGrowth, jan.audienceGrowth)}%</td></tr>
            </tbody>
          </table>
        </div>
        <div class="card">
          <div class="card-title">Content Metrics <span class="type-label type-content">CONTENT</span></div>
          <table class="comparison-table">
            <thead><tr><th>Metric</th><th><span class="month-badge badge-jan">Jan</span></th><th><span class="month-badge badge-feb">Feb</span></th><th>Δ</th></tr></thead>
            <tbody>
              <tr><td>Posts</td><td>${jan.postsPublished}</td><td>${feb.postsPublished}</td><td class="${pctChange(feb.postsPublished, jan.postsPublished) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.postsPublished, jan.postsPublished) >= 0 ? '+' : ''}${pctChange(feb.postsPublished, jan.postsPublished)}%</td></tr>
              <tr><td>Reels</td><td>${jan.reels}</td><td>${feb.reels}</td><td class="${pctChange(feb.reels, jan.reels) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.reels, jan.reels) >= 0 ? '+' : ''}${pctChange(feb.reels, jan.reels)}%</td></tr>
              <tr><td>Stories</td><td>${jan.stories}</td><td>${feb.stories}</td><td class="${pctChange(feb.stories, jan.stories) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.stories, jan.stories) >= 0 ? '+' : ''}${pctChange(feb.stories, jan.stories)}%</td></tr>
              <tr><td>Link Clicks</td><td>${jan.postClicks}</td><td>${feb.postClicks}</td><td class="${pctChange(feb.postClicks, jan.postClicks) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.postClicks, jan.postClicks) >= 0 ? '+' : ''}${pctChange(feb.postClicks, jan.postClicks)}%</td></tr>
              <tr><td>Shares</td><td>${jan.shares}</td><td>${feb.shares}</td><td class="${pctChange(feb.shares, jan.shares) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.shares, jan.shares) >= 0 ? '+' : ''}${pctChange(feb.shares, jan.shares)}%</td></tr>
              <tr><td>Saves</td><td>${jan.saves}</td><td>${feb.saves}</td><td class="${pctChange(feb.saves, jan.saves) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.saves, jan.saves) >= 0 ? '+' : ''}${pctChange(feb.saves, jan.saves)}%</td></tr>
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
          <div class="card-title">Engagement Rate Over Time</div>
          <div class="chart-container"><canvas id="engRateChart"></canvas></div>
        </div>
        <div class="card">
          <div class="card-title">Impressions & Engagements</div>
          <div class="chart-container"><canvas id="trendsChart"></canvas></div>
        </div>
      </div>
    </div>
    
    <p class="refresh-note">Data: Jan 1 - Feb 27, 2026 • @veintreatmentclinic • Content: ${totalContent} pieces | Organic: ${organicSentiment.total} msgs | Paid: ${paidSentiment.total} msgs</p>
  </div>
  
  <script>
    const dailyData = ${JSON.stringify(metrics.daily)};
    
    // Engagement Rate Chart
    new Chart(document.getElementById('engRateChart'), {
      type: 'line',
      data: {
        labels: dailyData.filter(d => d.engagementRate > 0).map(d => d.date),
        datasets: [{
          label: 'Engagement Rate %',
          data: dailyData.filter(d => d.engagementRate > 0).map(d => d.engagementRate),
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139,92,246,0.1)',
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
          y: { ticks: { color: '#8b5cf6', callback: v => v + '%' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        }
      }
    });
    
    // Trends Chart
    new Chart(document.getElementById('trendsChart'), {
      type: 'line',
      data: {
        labels: dailyData.map(d => d.date),
        datasets: [{
          label: 'Impressions',
          data: dailyData.map(d => d.impressions),
          borderColor: '#4ade80',
          backgroundColor: 'rgba(74,222,128,0.1)',
          fill: true,
          tension: 0.4,
          yAxisID: 'y'
        }, {
          label: 'Engagements',
          data: dailyData.map(d => d.engagements),
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245,158,11,0.1)',
          fill: true,
          tension: 0.4,
          yAxisID: 'y1'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#fff' } } },
        scales: {
          x: { ticks: { color: '#888', maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { position: 'left', ticks: { color: '#4ade80' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y1: { position: 'right', ticks: { color: '#f59e0b' }, grid: { display: false } }
        }
      }
    });
  </script>
</body>
</html>`;
  res.send(html);
});

app.listen(PORT, () => console.log(`Dashboard running on port ${PORT}`));
