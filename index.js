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

// Parse CSV properly (handling quoted fields)
function parseCSV(content) {
  const lines = content.trim().split('\n');
  const result = [];
  
  for (let i = 0; i < lines.length; i++) {
    const row = [];
    let current = '';
    let inQuotes = false;
    
    for (let j = 0; j < lines[i].length; j++) {
      const char = lines[i][j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        row.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    row.push(current.trim());
    result.push(row);
  }
  
  // Convert to objects using first row as headers
  const headers = result[0];
  const data = [];
  for (let i = 1; i < result.length; i++) {
    const obj = {};
    headers.forEach((h, idx) => {
      let val = result[i][idx] || '';
      if (val && /^[\d,]+$/.test(val)) {
        val = parseInt(val.replace(/,/g, ''), 10);
      } else if (val && /^\d+(\.\d+)?%$/.test(val)) {
        val = parseFloat(val.replace('%', ''));
      }
      obj[h] = val;
    });
    data.push(obj);
  }
  return data;
}

// Sentiment analysis keywords
const positiveWords = ['thank', 'thanks', 'love', 'great', 'amazing', 'awesome', 'excellent', 'good', 'best', 'wonderful', 'helpful', 'beautiful', 'happy', '❤️', '💙', '👍', '🙏', '😊', '🥰', 'appreciate', 'perfect'];
const negativeWords = ['bad', 'terrible', 'awful', 'hate', 'worst', 'horrible', 'disappointed', 'angry', 'frustrated', 'complain', 'problem', 'issue', 'pain', 'hurt', 'scam', 'fake', '😡', '😤', '👎', 'not working', 'doesn\'t work'];
const questionWords = ['how', 'what', 'where', 'when', 'why', 'can', 'do you', 'is there', 'does', '?', 'help', 'need'];

function analyzeSentiment(message) {
  const lower = message.toLowerCase();
  
  let positiveScore = 0;
  let negativeScore = 0;
  let isQuestion = false;
  
  positiveWords.forEach(word => {
    if (lower.includes(word)) positiveScore++;
  });
  
  negativeWords.forEach(word => {
    if (lower.includes(word)) negativeScore++;
  });
  
  questionWords.forEach(word => {
    if (lower.includes(word)) isQuestion = true;
  });
  
  if (positiveScore > negativeScore) return 'positive';
  if (negativeScore > positiveScore) return 'negative';
  if (isQuestion) return 'inquiry';
  return 'neutral';
}

// Load performance data
const perfPath = path.join(__dirname, 'data.csv');
const perfContent = fs.readFileSync(perfPath, 'utf8');
const perfData = parseCSV(perfContent);

// Load inbox data
const inboxPath = path.join(__dirname, 'inbox.csv');
const inboxContent = fs.readFileSync(inboxPath, 'utf8');
const inboxData = parseCSV(inboxContent);

// Process inbox for sentiment
const processedInbox = inboxData.map(row => {
  const message = row['Message'] || '';
  return {
    date: row['Timestamp (ET)'] || '',
    type: row['Type'] || '',
    network: row['Network'] || '',
    messageType: row['Message Type'] || '',
    message: message,
    sentiment: analyzeSentiment(message),
    language: row['Language'] || ''
  };
});

// Count sentiments
const sentimentCounts = {
  positive: processedInbox.filter(m => m.sentiment === 'positive').length,
  negative: processedInbox.filter(m => m.sentiment === 'negative').length,
  neutral: processedInbox.filter(m => m.sentiment === 'neutral').length,
  inquiry: processedInbox.filter(m => m.sentiment === 'inquiry').length
};

const totalSentiment = Object.values(sentimentCounts).reduce((a, b) => a + b, 0);
const sentimentScore = totalSentiment > 0 
  ? Math.round(((sentimentCounts.positive - sentimentCounts.negative) / totalSentiment * 50) + 50)
  : 50;

// Network breakdown
const networkCounts = {};
processedInbox.forEach(m => {
  networkCounts[m.network] = (networkCounts[m.network] || 0) + 1;
});

// Calculate metrics
function calculateMetrics(data) {
  const jan = data.filter(r => r.Date && r.Date.startsWith('01-'));
  const feb = data.filter(r => r.Date && r.Date.startsWith('02-'));
  
  const sum = (arr, key) => arr.reduce((s, r) => s + (parseInt(r[key]) || 0), 0);
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
      audienceEnd: last(jan, 'Audience'),
      audienceGrowth: sum(jan, 'Net Audience Growth'),
      postsPublished: sum(jan, 'Published Posts (Total)'),
      messagesSent: sum(jan, 'Sent Messages (Total)'),
      messagesReceived: sum(jan, 'Received Messages (Total)'),
      reels: sum(jan, 'Sent Reels (Instagram)'),
      stories: sum(jan, 'Sent Stories (Instagram)')
    },
    february: {
      impressions: sum(feb, 'Impressions'),
      videoViews: sum(feb, 'Video Views'),
      engagements: sum(feb, 'Engagements'),
      reactions: sum(feb, 'Reactions'),
      comments: sum(feb, 'Comments'),
      shares: sum(feb, 'Shares'),
      saves: sum(feb, 'Saves'),
      audienceEnd: last(feb, 'Audience') || 28475,
      audienceGrowth: sum(feb, 'Net Audience Growth'),
      postsPublished: sum(feb, 'Published Posts (Total)'),
      messagesSent: sum(feb, 'Sent Messages (Total)'),
      messagesReceived: sum(feb, 'Received Messages (Total)'),
      reels: sum(feb, 'Sent Reels (Instagram)'),
      stories: sum(feb, 'Sent Stories (Instagram)')
    },
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

// Targets for gauges
const targets = {
  impressions: 30000000,
  videoViews: 100000,
  engagements: 2000,
  audienceGrowth: 2000,
  sentimentScore: 80
};

app.get('/', (req, res) => {
  const jan = metrics.january;
  const feb = metrics.february;
  
  const pctChange = (curr, prev) => prev ? Math.round(((curr - prev) / prev) * 100) : 0;
  
  const changes = {
    impressions: pctChange(feb.impressions, jan.impressions),
    videoViews: pctChange(feb.videoViews, jan.videoViews),
    engagements: pctChange(feb.engagements, jan.engagements),
    audienceGrowth: pctChange(feb.audienceGrowth, jan.audienceGrowth)
  };
  
  const gauge = (val, target) => Math.min(100, Math.round((val / target) * 100));
  
  // Sample recent messages for display
  const recentMessages = processedInbox.slice(0, 10).map(m => ({
    ...m,
    shortMessage: m.message.length > 100 ? m.message.substring(0, 100) + '...' : m.message
  }));
  
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
    .card-title { font-size: 0.9rem; opacity: 0.7; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .card-value { font-size: 2.2rem; font-weight: 600; margin-bottom: 12px; }
    .card-change { font-size: 0.9rem; display: flex; align-items: center; gap: 5px; }
    .positive { color: #4ade80; }
    .negative { color: #f87171; }
    .neutral { color: #fbbf24; }
    .inquiry { color: #60a5fa; }
    
    .gauge-container { position: relative; width: 100%; height: 12px; background: rgba(255,255,255,0.1); border-radius: 6px; margin-top: 15px; overflow: hidden; }
    .gauge-fill { height: 100%; border-radius: 6px; transition: width 0.5s ease; }
    .gauge-excellent { background: linear-gradient(90deg, #4ade80, #22c55e); }
    .gauge-good { background: linear-gradient(90deg, #fbbf24, #f59e0b); }
    .gauge-needs-work { background: linear-gradient(90deg, #f87171, #ef4444); }
    .gauge-label { display: flex; justify-content: space-between; font-size: 0.75rem; opacity: 0.6; margin-top: 5px; }
    
    .comparison-table { width: 100%; border-collapse: collapse; }
    .comparison-table th, .comparison-table td { padding: 12px 16px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .comparison-table th { font-weight: 500; opacity: 0.7; font-size: 0.85rem; text-transform: uppercase; }
    .comparison-table td:not(:first-child) { text-align: right; }
    
    .sentiment-score { font-size: 4rem; font-weight: 700; text-align: center; margin: 20px 0; }
    .sentiment-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-top: 20px; }
    .sentiment-item { text-align: center; padding: 15px; background: rgba(255,255,255,0.05); border-radius: 12px; }
    .sentiment-count { font-size: 1.8rem; font-weight: 600; }
    .sentiment-label { font-size: 0.8rem; opacity: 0.7; margin-top: 5px; }
    
    .message-list { max-height: 400px; overflow-y: auto; }
    .message-item { padding: 15px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; gap: 15px; }
    .message-item:last-child { border-bottom: none; }
    .message-badge { padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 500; white-space: nowrap; }
    .badge-positive { background: rgba(74, 222, 128, 0.2); color: #4ade80; }
    .badge-negative { background: rgba(248, 113, 113, 0.2); color: #f87171; }
    .badge-neutral { background: rgba(251, 191, 36, 0.2); color: #fbbf24; }
    .badge-inquiry { background: rgba(96, 165, 250, 0.2); color: #60a5fa; }
    .badge-network { background: rgba(139, 92, 246, 0.2); color: #a78bfa; }
    .message-content { flex: 1; }
    .message-text { font-size: 0.9rem; line-height: 1.5; }
    .message-meta { font-size: 0.75rem; opacity: 0.6; margin-top: 8px; }
    
    .chart-container { position: relative; height: 300px; margin-top: 20px; }
    .month-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 500; }
    .badge-jan { background: #3b82f6; }
    .badge-feb { background: #8b5cf6; }
    .refresh-note { text-align: center; opacity: 0.5; font-size: 0.8rem; margin-top: 30px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 VeinTreatmentClinic Analytics</h1>
    <p class="subtitle">Instagram Performance Dashboard • January - February 2026</p>
    
    <!-- Performance Overview -->
    <div class="section">
      <h2 class="section-title">📈 Performance Overview</h2>
      <div class="grid grid-4">
        <div class="card">
          <div class="card-title">Total Impressions</div>
          <div class="card-value">${((jan.impressions + feb.impressions) / 1000000).toFixed(1)}M</div>
          <div class="card-change ${changes.impressions >= 0 ? 'positive' : 'negative'}">${changes.impressions >= 0 ? '↑' : '↓'} ${Math.abs(changes.impressions)}% vs Jan</div>
          <div class="gauge-container"><div class="gauge-fill ${gauge(jan.impressions + feb.impressions, targets.impressions) >= 70 ? 'gauge-excellent' : 'gauge-good'}" style="width: ${gauge(jan.impressions + feb.impressions, targets.impressions)}%"></div></div>
          <div class="gauge-label"><span>0</span><span>Target: 30M</span></div>
        </div>
        <div class="card">
          <div class="card-title">Video Views</div>
          <div class="card-value">${((jan.videoViews + feb.videoViews) / 1000).toFixed(0)}K</div>
          <div class="card-change ${changes.videoViews >= 0 ? 'positive' : 'negative'}">${changes.videoViews >= 0 ? '↑' : '↓'} ${Math.abs(changes.videoViews)}% vs Jan</div>
          <div class="gauge-container"><div class="gauge-fill gauge-excellent" style="width: ${gauge(jan.videoViews + feb.videoViews, targets.videoViews)}%"></div></div>
          <div class="gauge-label"><span>0</span><span>Target: 100K</span></div>
        </div>
        <div class="card">
          <div class="card-title">Total Engagements</div>
          <div class="card-value">${(jan.engagements + feb.engagements).toLocaleString()}</div>
          <div class="card-change ${changes.engagements >= 0 ? 'positive' : 'negative'}">${changes.engagements >= 0 ? '↑' : '↓'} ${Math.abs(changes.engagements)}% vs Jan</div>
          <div class="gauge-container"><div class="gauge-fill gauge-excellent" style="width: ${gauge(jan.engagements + feb.engagements, targets.engagements)}%"></div></div>
          <div class="gauge-label"><span>0</span><span>Target: 2K</span></div>
        </div>
        <div class="card">
          <div class="card-title">Audience Growth</div>
          <div class="card-value">+${(jan.audienceGrowth + feb.audienceGrowth).toLocaleString()}</div>
          <div class="card-change ${changes.audienceGrowth >= 0 ? 'positive' : 'negative'}">${changes.audienceGrowth >= 0 ? '↑' : '↓'} ${Math.abs(changes.audienceGrowth)}% vs Jan</div>
          <div class="gauge-container"><div class="gauge-fill gauge-excellent" style="width: ${gauge(jan.audienceGrowth + feb.audienceGrowth, targets.audienceGrowth)}%"></div></div>
          <div class="gauge-label"><span>0</span><span>Target: 2K</span></div>
        </div>
      </div>
    </div>
    
    <!-- Sentiment Tracking -->
    <div class="section">
      <h2 class="section-title">💬 Inbox Sentiment Analysis</h2>
      <div class="grid grid-3">
        <div class="card">
          <div class="card-title">Sentiment Score</div>
          <div class="sentiment-score ${sentimentScore >= 60 ? 'positive' : sentimentScore >= 40 ? 'neutral' : 'negative'}">${sentimentScore}</div>
          <div style="text-align:center;opacity:0.7">${sentimentScore >= 70 ? '😊 Excellent' : sentimentScore >= 50 ? '🙂 Good' : '😐 Neutral'}</div>
          <div class="gauge-container"><div class="gauge-fill ${sentimentScore >= 60 ? 'gauge-excellent' : 'gauge-good'}" style="width: ${sentimentScore}%"></div></div>
          <div class="gauge-label"><span>0 (Negative)</span><span>100 (Positive)</span></div>
          <div class="sentiment-grid">
            <div class="sentiment-item">
              <div class="sentiment-count positive">${sentimentCounts.positive}</div>
              <div class="sentiment-label">Positive</div>
            </div>
            <div class="sentiment-item">
              <div class="sentiment-count neutral">${sentimentCounts.neutral}</div>
              <div class="sentiment-label">Neutral</div>
            </div>
            <div class="sentiment-item">
              <div class="sentiment-count negative">${sentimentCounts.negative}</div>
              <div class="sentiment-label">Negative</div>
            </div>
            <div class="sentiment-item">
              <div class="sentiment-count inquiry">${sentimentCounts.inquiry}</div>
              <div class="sentiment-label">Inquiries</div>
            </div>
          </div>
        </div>
        
        <div class="card" style="grid-column: span 2">
          <div class="card-title">Recent Inbox Messages (${totalSentiment} total)</div>
          <div class="message-list">
            ${recentMessages.map(m => `
              <div class="message-item">
                <div>
                  <span class="message-badge badge-${m.sentiment}">${m.sentiment}</span>
                  <span class="message-badge badge-network">${m.network}</span>
                </div>
                <div class="message-content">
                  <div class="message-text">${m.shortMessage || '(empty)'}</div>
                  <div class="message-meta">${m.messageType} • ${m.date}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      
      <div class="grid grid-4" style="margin-top:20px">
        ${Object.entries(networkCounts).map(([network, count]) => `
          <div class="card">
            <div class="card-title">${network}</div>
            <div class="card-value">${count}</div>
            <div style="opacity:0.7">messages</div>
            <div class="gauge-container"><div class="gauge-fill gauge-good" style="width: ${Math.round(count / totalSentiment * 100)}%"></div></div>
          </div>
        `).join('')}
      </div>
    </div>
    
    <!-- Monthly Comparison -->
    <div class="section">
      <h2 class="section-title">📅 Monthly Comparison</h2>
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Organic Performance</div>
          <table class="comparison-table">
            <thead><tr><th>Metric</th><th><span class="month-badge badge-jan">Jan</span></th><th><span class="month-badge badge-feb">Feb</span></th><th>Change</th></tr></thead>
            <tbody>
              <tr><td>Impressions</td><td>${(jan.impressions / 1000000).toFixed(2)}M</td><td>${(feb.impressions / 1000000).toFixed(2)}M</td><td class="${changes.impressions >= 0 ? 'positive' : 'negative'}">${changes.impressions >= 0 ? '+' : ''}${changes.impressions}%</td></tr>
              <tr><td>Video Views</td><td>${(jan.videoViews / 1000).toFixed(1)}K</td><td>${(feb.videoViews / 1000).toFixed(1)}K</td><td class="${changes.videoViews >= 0 ? 'positive' : 'negative'}">${changes.videoViews >= 0 ? '+' : ''}${changes.videoViews}%</td></tr>
              <tr><td>Engagements</td><td>${jan.engagements.toLocaleString()}</td><td>${feb.engagements.toLocaleString()}</td><td class="${changes.engagements >= 0 ? 'positive' : 'negative'}">${changes.engagements >= 0 ? '+' : ''}${changes.engagements}%</td></tr>
              <tr><td>Reactions</td><td>${jan.reactions}</td><td>${feb.reactions}</td><td class="${pctChange(feb.reactions, jan.reactions) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.reactions, jan.reactions) >= 0 ? '+' : ''}${pctChange(feb.reactions, jan.reactions)}%</td></tr>
              <tr><td>Comments</td><td>${jan.comments}</td><td>${feb.comments}</td><td class="${pctChange(feb.comments, jan.comments) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.comments, jan.comments) >= 0 ? '+' : ''}${pctChange(feb.comments, jan.comments)}%</td></tr>
              <tr><td>Shares</td><td>${jan.shares}</td><td>${feb.shares}</td><td class="${pctChange(feb.shares, jan.shares) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.shares, jan.shares) >= 0 ? '+' : ''}${pctChange(feb.shares, jan.shares)}%</td></tr>
              <tr><td>Saves</td><td>${jan.saves}</td><td>${feb.saves}</td><td class="${pctChange(feb.saves, jan.saves) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.saves, jan.saves) >= 0 ? '+' : ''}${pctChange(feb.saves, jan.saves)}%</td></tr>
            </tbody>
          </table>
        </div>
        <div class="card">
          <div class="card-title">Content & Audience</div>
          <table class="comparison-table">
            <thead><tr><th>Metric</th><th><span class="month-badge badge-jan">Jan</span></th><th><span class="month-badge badge-feb">Feb</span></th><th>Change</th></tr></thead>
            <tbody>
              <tr><td>Audience (End)</td><td>${jan.audienceEnd.toLocaleString()}</td><td>${feb.audienceEnd.toLocaleString()}</td><td class="positive">+${(feb.audienceEnd - jan.audienceEnd).toLocaleString()}</td></tr>
              <tr><td>Net Growth</td><td>+${jan.audienceGrowth.toLocaleString()}</td><td>+${feb.audienceGrowth.toLocaleString()}</td><td class="${changes.audienceGrowth >= 0 ? 'positive' : 'negative'}">${changes.audienceGrowth >= 0 ? '+' : ''}${changes.audienceGrowth}%</td></tr>
              <tr><td>Posts</td><td>${jan.postsPublished}</td><td>${feb.postsPublished}</td><td class="${pctChange(feb.postsPublished, jan.postsPublished) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.postsPublished, jan.postsPublished) >= 0 ? '+' : ''}${pctChange(feb.postsPublished, jan.postsPublished)}%</td></tr>
              <tr><td>Reels</td><td>${jan.reels}</td><td>${feb.reels}</td><td class="${pctChange(feb.reels, jan.reels) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.reels, jan.reels) >= 0 ? '+' : ''}${pctChange(feb.reels, jan.reels)}%</td></tr>
              <tr><td>Stories</td><td>${jan.stories}</td><td>${feb.stories}</td><td class="${pctChange(feb.stories, jan.stories) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.stories, jan.stories) >= 0 ? '+' : ''}${pctChange(feb.stories, jan.stories)}%</td></tr>
              <tr><td>DMs Received</td><td>${jan.messagesReceived}</td><td>${feb.messagesReceived}</td><td class="${pctChange(feb.messagesReceived, jan.messagesReceived) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.messagesReceived, jan.messagesReceived) >= 0 ? '+' : ''}${pctChange(feb.messagesReceived, jan.messagesReceived)}%</td></tr>
              <tr><td>DMs Sent</td><td>${jan.messagesSent}</td><td>${feb.messagesSent}</td><td class="${pctChange(feb.messagesSent, jan.messagesSent) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.messagesSent, jan.messagesSent) >= 0 ? '+' : ''}${pctChange(feb.messagesSent, jan.messagesSent)}%</td></tr>
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
        <div class="card">
          <div class="card-title">Reactions</div>
          <div class="card-value">${(jan.reactions + feb.reactions).toLocaleString()}</div>
          <div class="gauge-container"><div class="gauge-fill gauge-excellent" style="width: ${Math.min(100, (jan.reactions + feb.reactions) / 15)}%"></div></div>
        </div>
        <div class="card">
          <div class="card-title">Comments</div>
          <div class="card-value">${jan.comments + feb.comments}</div>
          <div class="gauge-container"><div class="gauge-fill gauge-good" style="width: ${Math.min(100, (jan.comments + feb.comments) / 2)}%"></div></div>
        </div>
        <div class="card">
          <div class="card-title">Shares</div>
          <div class="card-value">${jan.shares + feb.shares}</div>
          <div class="gauge-container"><div class="gauge-fill gauge-excellent" style="width: ${Math.min(100, (jan.shares + feb.shares) / 3)}%"></div></div>
        </div>
        <div class="card">
          <div class="card-title">Saves</div>
          <div class="card-value">${jan.saves + feb.saves}</div>
          <div class="gauge-container"><div class="gauge-fill gauge-excellent" style="width: ${Math.min(100, (jan.saves + feb.saves) / 5)}%"></div></div>
        </div>
      </div>
    </div>
    
    <p class="refresh-note">Data: Jan 1 - Feb 27, 2026 • @veintreatmentclinic • Inbox: ${totalSentiment} messages analyzed</p>
  </div>
  
  <script>
    const dailyData = ${JSON.stringify(metrics.daily)};
    
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
        plugins: { legend: { labels: { color: '#fff' } } },
        scales: {
          x: { ticks: { color: '#888', maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { position: 'left', ticks: { color: '#3b82f6' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y1: { position: 'right', ticks: { color: '#8b5cf6' }, grid: { display: false } }
        }
      }
    });
    
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
