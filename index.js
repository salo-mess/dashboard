const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

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

// Fetch helper
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Parse RSS
function parseRSS(xml) {
  const items = [];
  const regex = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>[\s\S]*?<link>(.*?)<\/link>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?<\/item>/g;
  let match;
  while ((match = regex.exec(xml)) !== null && items.length < 10) {
    items.push({
      title: match[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
      link: match[2],
      date: new Date(match[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    });
  }
  return items;
}

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

// Sentiment
const positiveWords = ['thank', 'thanks', 'love', 'great', 'amazing', 'awesome', 'excellent', 'good', 'best', 'wonderful', 'helpful', '❤️', '💙', '👍', '🙏', '😊'];
const negativeWords = ['bad', 'terrible', 'awful', 'hate', 'worst', 'horrible', 'disappointed', 'angry', 'frustrated', 'scam', 'fake', '😡', '👎'];
const questionWords = ['how', 'what', 'where', 'when', 'why', 'can', 'do you', 'is there', '?', 'help', 'need'];

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
const competitors = JSON.parse(fs.readFileSync(path.join(__dirname, 'competitors.json'), 'utf8'));

// Process inbox
const processedInbox = inboxData.map(row => {
  const message = row['Message'] || '';
  const msgType = row['Message Type'] || '';
  return { message, sentiment: analyzeSentiment(message), isPaid: msgType.toLowerCase().includes('ad') };
});
const organicInbox = processedInbox.filter(m => !m.isPaid);
const paidInbox = processedInbox.filter(m => m.isPaid);
const countSentiments = (arr) => ({ positive: arr.filter(m => m.sentiment === 'positive').length, negative: arr.filter(m => m.sentiment === 'negative').length, neutral: arr.filter(m => m.sentiment === 'neutral').length, inquiry: arr.filter(m => m.sentiment === 'inquiry').length, total: arr.length });
const organicSentiment = countSentiments(organicInbox);
const paidSentiment = countSentiments(paidInbox);
const calcScore = (s) => s.total > 0 ? Math.round(((s.positive - s.negative) / s.total * 50) + 50) : 50;

// Calculate metrics
function calculateMetrics(data) {
  const jan = data.filter(r => r.Date && r.Date.startsWith('01-'));
  const feb = data.filter(r => r.Date && r.Date.startsWith('02-'));
  const sum = (arr, key) => arr.reduce((s, r) => s + (parseInt(r[key]) || 0), 0);
  const avg = (arr, key) => { const vals = arr.map(r => parseFloat(r[key]) || 0).filter(v => v > 0); return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0; };
  const last = (arr, key) => arr.length ? (parseInt(arr[arr.length - 1][key]) || 0) : 0;
  const calcMonth = (arr) => ({
    impressions: sum(arr, 'Impressions'), videoViews: sum(arr, 'Video Views'), engagements: sum(arr, 'Engagements'),
    reactions: sum(arr, 'Reactions'), comments: sum(arr, 'Comments'), shares: sum(arr, 'Shares'), saves: sum(arr, 'Saves'),
    postClicks: sum(arr, 'Post Link Clicks'), audienceEnd: last(arr, 'Audience') || 28475, audienceGrowth: sum(arr, 'Net Audience Growth'),
    postsPublished: sum(arr, 'Published Posts (Total)'), reels: sum(arr, 'Sent Reels (Instagram)'), stories: sum(arr, 'Sent Stories (Instagram)'),
    adCommentsReceived: sum(arr, 'Received Ad Comments (Facebook)') + sum(arr, 'Received Ad Comments (Instagram)'),
    engagementRate: avg(arr, 'Engagement Rate (per Impression)')
  });
  return { january: calcMonth(jan), february: calcMonth(feb), daily: data.map(r => ({ date: r.Date, impressions: parseInt(r.Impressions) || 0, engagements: parseInt(r.Engagements) || 0, audience: parseInt(r.Audience) || 0, engagementRate: parseFloat(r['Engagement Rate (per Impression)']) || 0 })) };
}

const metrics = calculateMetrics(perfData);
const jan = metrics.january;
const feb = metrics.february;
const pctChange = (curr, prev) => prev ? Math.round(((curr - prev) / prev) * 100) : 0;
const gauge = (val, target) => Math.min(100, Math.round((val / target) * 100));
const totalContent = jan.postsPublished + feb.postsPublished + jan.reels + feb.reels + jan.stories + feb.stories;
const avgEngRate = ((jan.engagementRate + feb.engagementRate) / 2).toFixed(3);

// Main route
app.get('/', async (req, res) => {
  // Fetch industry news
  let industryNews = [], competitorNews = [], trendingTopics = [];
  try {
    const [industry, compNews, trends] = await Promise.all([
      fetchUrl('https://news.google.com/rss/search?q=varicose+veins+treatment+OR+spider+veins+OR+vein+clinic&hl=en-US&gl=US&ceid=US:en').catch(() => ''),
      fetchUrl('https://news.google.com/rss/search?q=USA+Vein+Clinics+OR+Center+for+Vein+Restoration+OR+vein+treatment+industry&hl=en-US&gl=US&ceid=US:en').catch(() => ''),
      fetchUrl('https://news.google.com/rss/search?q=medical+aesthetics+OR+cosmetic+procedures+OR+minimally+invasive+treatment&hl=en-US&gl=US&ceid=US:en').catch(() => '')
    ]);
    industryNews = parseRSS(industry);
    competitorNews = parseRSS(compNews);
    trendingTopics = parseRSS(trends);
  } catch (e) { console.error('News fetch error:', e.message); }

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
    .card-listen { border-left: 4px solid #06b6d4; }
    .card-compete { border-left: 4px solid #ec4899; }
    .card-title { font-size: 0.85rem; opacity: 0.7; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .card-value { font-size: 2rem; font-weight: 600; margin-bottom: 8px; }
    .card-change { font-size: 0.85rem; }
    .positive { color: #4ade80; }
    .negative { color: #f87171; }
    .neutral { color: #fbbf24; }
    .gauge-container { width: 100%; height: 10px; background: rgba(255,255,255,0.1); border-radius: 5px; margin-top: 12px; overflow: hidden; }
    .gauge-fill { height: 100%; border-radius: 5px; }
    .gauge-green { background: linear-gradient(90deg, #4ade80, #22c55e); }
    .gauge-orange { background: linear-gradient(90deg, #fbbf24, #f59e0b); }
    .gauge-purple { background: linear-gradient(90deg, #a78bfa, #8b5cf6); }
    .gauge-cyan { background: linear-gradient(90deg, #22d3ee, #06b6d4); }
    .gauge-pink { background: linear-gradient(90deg, #f472b6, #ec4899); }
    .divider { display: flex; align-items: center; gap: 15px; margin: 30px 0; }
    .divider-line { flex: 1; height: 1px; background: rgba(255,255,255,0.1); }
    .divider-text { font-size: 0.85rem; opacity: 0.7; text-transform: uppercase; letter-spacing: 1px; }
    .news-list { max-height: 300px; overflow-y: auto; }
    .news-item { padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .news-item:last-child { border-bottom: none; }
    .news-item a { color: #fff; text-decoration: none; font-size: 0.9rem; line-height: 1.4; }
    .news-item a:hover { color: #06b6d4; }
    .news-date { font-size: 0.75rem; opacity: 0.5; margin-top: 4px; }
    .competitor-card { padding: 15px; background: rgba(255,255,255,0.03); border-radius: 10px; margin-bottom: 10px; }
    .competitor-name { font-weight: 600; margin-bottom: 5px; }
    .competitor-info { font-size: 0.8rem; opacity: 0.7; }
    .threat-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.7rem; font-weight: 500; margin-left: 8px; }
    .threat-high { background: rgba(239, 68, 68, 0.2); color: #f87171; }
    .threat-medium { background: rgba(251, 191, 36, 0.2); color: #fbbf24; }
    .threat-low { background: rgba(74, 222, 128, 0.2); color: #4ade80; }
    .threat-emerging { background: rgba(139, 92, 246, 0.2); color: #a78bfa; }
    .insight-box { background: rgba(6, 182, 212, 0.1); border: 1px solid rgba(6, 182, 212, 0.3); padding: 15px; border-radius: 10px; margin-top: 15px; }
    .insight-title { font-size: 0.85rem; font-weight: 600; color: #22d3ee; margin-bottom: 8px; }
    .insight-text { font-size: 0.85rem; opacity: 0.8; line-height: 1.5; }
    .chart-container { position: relative; height: 250px; margin-top: 15px; }
    .comparison-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .comparison-table th, .comparison-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .comparison-table th { font-weight: 500; opacity: 0.7; font-size: 0.75rem; text-transform: uppercase; }
    .comparison-table td:not(:first-child) { text-align: right; }
    .stat-highlight { background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.3); padding: 15px; border-radius: 12px; text-align: center; }
    .stat-big { font-size: 2.5rem; font-weight: 700; color: #a78bfa; }
    .stat-label { font-size: 0.8rem; opacity: 0.7; margin-top: 5px; }
    .month-badge { display: inline-block; padding: 3px 10px; border-radius: 15px; font-size: 0.75rem; font-weight: 500; }
    .badge-jan { background: #3b82f6; }
    .badge-feb { background: #8b5cf6; }
    .refresh-note { text-align: center; opacity: 0.5; font-size: 0.75rem; margin-top: 30px; }
    .keyword-tag { display: inline-block; padding: 4px 10px; margin: 3px; background: rgba(6, 182, 212, 0.2); border-radius: 15px; font-size: 0.75rem; color: #22d3ee; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 VeinTreatmentClinic Analytics</h1>
    <p class="subtitle">Performance + Social Listening + Competitive Intelligence</p>
    
    <!-- SOCIAL LISTENING -->
    <div class="divider">
      <div class="divider-line"></div>
      <div class="divider-text">👂 Social Listening & Industry Intel</div>
      <div class="divider-line"></div>
    </div>
    
    <div class="section">
      <div class="grid grid-3">
        <div class="card card-listen">
          <div class="card-title">🔬 Industry News</div>
          <div class="news-list">
            ${industryNews.length > 0 ? industryNews.map(n => `
              <div class="news-item">
                <a href="${n.link}" target="_blank">${n.title}</a>
                <div class="news-date">${n.date}</div>
              </div>
            `).join('') : '<div style="opacity:0.5;padding:20px;text-align:center">Loading industry news...</div>'}
          </div>
        </div>
        
        <div class="card card-listen">
          <div class="card-title">📰 Competitor Mentions</div>
          <div class="news-list">
            ${competitorNews.length > 0 ? competitorNews.map(n => `
              <div class="news-item">
                <a href="${n.link}" target="_blank">${n.title}</a>
                <div class="news-date">${n.date}</div>
              </div>
            `).join('') : '<div style="opacity:0.5;padding:20px;text-align:center">Loading competitor news...</div>'}
          </div>
        </div>
        
        <div class="card card-listen">
          <div class="card-title">🔥 Medical Aesthetics Trends</div>
          <div class="news-list">
            ${trendingTopics.length > 0 ? trendingTopics.map(n => `
              <div class="news-item">
                <a href="${n.link}" target="_blank">${n.title}</a>
                <div class="news-date">${n.date}</div>
              </div>
            `).join('') : '<div style="opacity:0.5;padding:20px;text-align:center">Loading trends...</div>'}
          </div>
        </div>
      </div>
      
      <div class="insight-box">
        <div class="insight-title">💡 Tracking Keywords</div>
        <div style="margin-top:10px">
          ${competitors.industryKeywords.map(k => `<span class="keyword-tag">${k}</span>`).join('')}
        </div>
      </div>
    </div>
    
    <!-- COMPETITIVE ANALYSIS -->
    <div class="divider">
      <div class="divider-line"></div>
      <div class="divider-text">🎯 Competitive Analysis</div>
      <div class="divider-line"></div>
    </div>
    
    <div class="section">
      <div class="grid grid-2">
        <div class="card card-compete">
          <div class="card-title">🏢 Direct Competitors</div>
          ${competitors.directCompetitors.map(c => `
            <div class="competitor-card">
              <div class="competitor-name">${c.name}</div>
              <div class="competitor-info">${c.handle} • ${c.locations} locations</div>
              <div class="competitor-info" style="margin-top:5px">${c.focus}</div>
            </div>
          `).join('')}
        </div>
        
        <div class="card card-compete">
          <div class="card-title">⚠️ Indirect Competitors</div>
          ${competitors.indirectCompetitors.map(c => `
            <div class="competitor-card">
              <div class="competitor-name">${c.name} <span class="threat-badge threat-${c.threat.toLowerCase()}">${c.threat}</span></div>
              <div class="competitor-info">${c.reason}</div>
            </div>
          `).join('')}
          <div class="insight-box">
            <div class="insight-title">🚨 Emerging Threat</div>
            <div class="insight-text">Telehealth platforms are entering the space — offering initial consultations and potentially capturing leads before they reach clinics.</div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- YOUR PERFORMANCE vs INDUSTRY -->
    <div class="divider">
      <div class="divider-line"></div>
      <div class="divider-text">📈 Your Performance</div>
      <div class="divider-line"></div>
    </div>
    
    <div class="section">
      <div class="grid grid-4">
        <div class="card card-organic">
          <div class="card-title">Impressions</div>
          <div class="card-value">${((jan.impressions + feb.impressions) / 1000000).toFixed(1)}M</div>
          <div class="card-change ${pctChange(feb.impressions, jan.impressions) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.impressions, jan.impressions) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.impressions, jan.impressions))}% MoM</div>
          <div class="gauge-container"><div class="gauge-fill gauge-green" style="width: ${gauge(jan.impressions + feb.impressions, 30000000)}%"></div></div>
        </div>
        <div class="card card-organic">
          <div class="card-title">Engagements</div>
          <div class="card-value">${(jan.engagements + feb.engagements).toLocaleString()}</div>
          <div class="card-change ${pctChange(feb.engagements, jan.engagements) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.engagements, jan.engagements) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.engagements, jan.engagements))}% MoM</div>
          <div class="gauge-container"><div class="gauge-fill gauge-green" style="width: ${gauge(jan.engagements + feb.engagements, 2000)}%"></div></div>
        </div>
        <div class="card card-content">
          <div class="card-title">Engagement Rate</div>
          <div class="card-value">${avgEngRate}%</div>
          <div class="card-change" style="opacity:0.7">Industry avg: 1-3%</div>
          <div class="gauge-container"><div class="gauge-fill gauge-purple" style="width: ${Math.min(100, parseFloat(avgEngRate) * 33)}%"></div></div>
        </div>
        <div class="card card-organic">
          <div class="card-title">Audience</div>
          <div class="card-value">${((feb.audienceEnd || 28475) / 1000).toFixed(1)}K</div>
          <div class="card-change positive">+${(jan.audienceGrowth + feb.audienceGrowth).toLocaleString()} growth</div>
          <div class="gauge-container"><div class="gauge-fill gauge-green" style="width: ${gauge(feb.audienceEnd || 28475, 50000)}%"></div></div>
        </div>
      </div>
    </div>
    
    <!-- CONTENT & PAID -->
    <div class="section">
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Content Performance <span style="color:#8b5cf6">ORGANIC</span></div>
          <table class="comparison-table">
            <thead><tr><th>Metric</th><th><span class="month-badge badge-jan">Jan</span></th><th><span class="month-badge badge-feb">Feb</span></th><th>Δ</th></tr></thead>
            <tbody>
              <tr><td>Posts</td><td>${jan.postsPublished}</td><td>${feb.postsPublished}</td><td class="${pctChange(feb.postsPublished, jan.postsPublished) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.postsPublished, jan.postsPublished) >= 0 ? '+' : ''}${pctChange(feb.postsPublished, jan.postsPublished)}%</td></tr>
              <tr><td>Reels</td><td>${jan.reels}</td><td>${feb.reels}</td><td class="${pctChange(feb.reels, jan.reels) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.reels, jan.reels) >= 0 ? '+' : ''}${pctChange(feb.reels, jan.reels)}%</td></tr>
              <tr><td>Stories</td><td>${jan.stories}</td><td>${feb.stories}</td><td class="${pctChange(feb.stories, jan.stories) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.stories, jan.stories) >= 0 ? '+' : ''}${pctChange(feb.stories, jan.stories)}%</td></tr>
              <tr><td>Reactions</td><td>${jan.reactions}</td><td>${feb.reactions}</td><td class="${pctChange(feb.reactions, jan.reactions) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.reactions, jan.reactions) >= 0 ? '+' : ''}${pctChange(feb.reactions, jan.reactions)}%</td></tr>
              <tr><td>Shares</td><td>${jan.shares}</td><td>${feb.shares}</td><td class="${pctChange(feb.shares, jan.shares) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.shares, jan.shares) >= 0 ? '+' : ''}${pctChange(feb.shares, jan.shares)}%</td></tr>
              <tr><td>Saves</td><td>${jan.saves}</td><td>${feb.saves}</td><td class="${pctChange(feb.saves, jan.saves) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.saves, jan.saves) >= 0 ? '+' : ''}${pctChange(feb.saves, jan.saves)}%</td></tr>
            </tbody>
          </table>
        </div>
        <div class="card">
          <div class="card-title">Paid & Sentiment <span style="color:#f59e0b">PAID</span></div>
          <table class="comparison-table">
            <tbody>
              <tr><td>Ad Comments</td><td colspan="2">${(jan.adCommentsReceived + feb.adCommentsReceived)}</td><td>${pctChange(feb.adCommentsReceived, jan.adCommentsReceived) >= 0 ? '+' : ''}${pctChange(feb.adCommentsReceived, jan.adCommentsReceived)}%</td></tr>
              <tr><td>Paid Messages</td><td colspan="2">${paidSentiment.total}</td><td>-</td></tr>
              <tr><td>Paid Sentiment</td><td colspan="2">${calcScore(paidSentiment)}/100</td><td>${calcScore(paidSentiment) >= 50 ? '😊' : '😐'}</td></tr>
              <tr><td>Paid Inquiries</td><td colspan="2">${paidSentiment.inquiry}</td><td>leads</td></tr>
            </tbody>
          </table>
          <div style="margin-top:15px;padding-top:15px;border-top:1px solid rgba(255,255,255,0.1)">
            <div class="card-title">Organic Sentiment</div>
            <div style="display:flex;gap:15px;margin-top:10px">
              <div style="flex:1;text-align:center"><div style="font-size:1.5rem;color:#4ade80">${organicSentiment.positive}</div><div style="font-size:0.7rem;opacity:0.7">Positive</div></div>
              <div style="flex:1;text-align:center"><div style="font-size:1.5rem;color:#fbbf24">${organicSentiment.neutral}</div><div style="font-size:0.7rem;opacity:0.7">Neutral</div></div>
              <div style="flex:1;text-align:center"><div style="font-size:1.5rem;color:#f87171">${organicSentiment.negative}</div><div style="font-size:0.7rem;opacity:0.7">Negative</div></div>
              <div style="flex:1;text-align:center"><div style="font-size:1.5rem;color:#60a5fa">${organicSentiment.inquiry}</div><div style="font-size:0.7rem;opacity:0.7">Inquiries</div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- CHARTS -->
    <div class="section">
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Engagement Rate Trend</div>
          <div class="chart-container"><canvas id="engRateChart"></canvas></div>
        </div>
        <div class="card">
          <div class="card-title">Impressions Over Time</div>
          <div class="chart-container"><canvas id="trendsChart"></canvas></div>
        </div>
      </div>
    </div>
    
    <p class="refresh-note">Data: Jan 1 - Feb 27, 2026 • @veintreatmentclinic • Last updated: ${new Date().toLocaleString()}</p>
  </div>
  
  <script>
    const dailyData = ${JSON.stringify(metrics.daily)};
    new Chart(document.getElementById('engRateChart'), {
      type: 'line', data: { labels: dailyData.filter(d => d.engagementRate > 0).map(d => d.date), datasets: [{ label: 'Eng Rate %', data: dailyData.filter(d => d.engagementRate > 0).map(d => d.engagementRate), borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.1)', fill: true, tension: 0.4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#fff' } } }, scales: { x: { ticks: { color: '#888', maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.05)' } }, y: { ticks: { color: '#8b5cf6' }, grid: { color: 'rgba(255,255,255,0.05)' } } } }
    });
    new Chart(document.getElementById('trendsChart'), {
      type: 'line', data: { labels: dailyData.map(d => d.date), datasets: [{ label: 'Impressions', data: dailyData.map(d => d.impressions), borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.1)', fill: true, tension: 0.4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#fff' } } }, scales: { x: { ticks: { color: '#888', maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.05)' } }, y: { ticks: { color: '#4ade80' }, grid: { color: 'rgba(255,255,255,0.05)' } } } }
    });
  </script>
</body>
</html>`;
  res.send(html);
});

app.listen(PORT, () => console.log(`Dashboard running on port ${PORT}`));
