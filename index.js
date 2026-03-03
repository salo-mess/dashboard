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
  while ((match = regex.exec(xml)) !== null && items.length < 8) {
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

// Load data
const perfData = parseCSV(fs.readFileSync(path.join(__dirname, 'data.csv'), 'utf8'));
const inboxData = parseCSV(fs.readFileSync(path.join(__dirname, 'inbox.csv'), 'utf8'));
const competitors = JSON.parse(fs.readFileSync(path.join(__dirname, 'competitors.json'), 'utf8'));

// Calculate metrics with date filtering
function calculateMetrics(data, startDate = null, endDate = null) {
  let filtered = data;
  if (startDate || endDate) {
    filtered = data.filter(r => {
      if (!r.Date) return false;
      const [month, day] = r.Date.split('-').map(Number);
      const date = new Date(2026, month - 1, day);
      if (startDate && date < new Date(startDate)) return false;
      if (endDate && date > new Date(endDate)) return false;
      return true;
    });
  }
  
  const jan = filtered.filter(r => r.Date && r.Date.startsWith('01-'));
  const feb = filtered.filter(r => r.Date && r.Date.startsWith('02-'));
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
  return { 
    january: calcMonth(jan), 
    february: calcMonth(feb), 
    total: calcMonth(filtered),
    daily: filtered.map(r => ({ 
      date: r.Date, 
      impressions: parseInt(r.Impressions) || 0, 
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
const avgEngRate = ((jan.engagementRate + feb.engagementRate) / 2).toFixed(3);

// Direct competitors list for separate feeds
const directCompetitorsList = [
  { name: 'USA Vein Clinics', query: 'USA+Vein+Clinics', color: '#ef4444' },
  { name: 'Center for Vein Restoration', query: 'Center+for+Vein+Restoration', color: '#f59e0b' },
  { name: 'Metro Vein Centers', query: 'Metro+Vein+Centers', color: '#8b5cf6' },
  { name: 'Vein Clinics of America', query: 'Vein+Clinics+of+America', color: '#06b6d4' },
  { name: 'AVLC', query: 'American+Vein+Lymphatic', color: '#ec4899' }
];

// States for local market intel
const statesList = [
  { name: 'New York', abbr: 'NY', query: 'New+York+OR+NYC+OR+Manhattan', color: '#3b82f6' },
  { name: 'New Jersey', abbr: 'NJ', query: 'New+Jersey', color: '#22c55e' },
  { name: 'California', abbr: 'CA', query: 'California+OR+Los+Angeles+OR+San+Francisco', color: '#f59e0b' },
  { name: 'Maryland', abbr: 'MD', query: 'Maryland+OR+Baltimore', color: '#ef4444' },
  { name: 'Connecticut', abbr: 'CT', query: 'Connecticut', color: '#8b5cf6' }
];

// Indirect competitors with detailed threat analysis
const indirectCompetitorsDetailed = [
  { 
    name: 'Medical Spas',
    threat: 'High',
    threatScore: 85,
    criteria: 'Service overlap + aggressive marketing + growing market share',
    overlap: ['Spider vein removal', 'Sclerotherapy', 'Cosmetic leg treatments'],
    query: 'medical+spa+vein+treatment+OR+medspa+spider+veins',
    marketGrowth: '+12% YoY',
    patientSteal: 'High - cosmetic-focused patients'
  },
  { 
    name: 'Dermatology Clinics',
    threat: 'Medium',
    threatScore: 60,
    criteria: 'Established trust + referral networks + insurance billing',
    overlap: ['Sclerotherapy', 'Laser treatments', 'Cosmetic procedures'],
    query: 'dermatologist+vein+removal+OR+dermatology+sclerotherapy',
    marketGrowth: '+5% YoY',
    patientSteal: 'Medium - cosmetic + medical crossover'
  },
  { 
    name: 'Plastic Surgery Centers',
    threat: 'Medium',
    threatScore: 55,
    criteria: 'Premium positioning + bundled procedures',
    overlap: ['Aesthetic leg treatments', 'Body contouring combos'],
    query: 'plastic+surgery+leg+veins+OR+cosmetic+surgery+varicose',
    marketGrowth: '+8% YoY',
    patientSteal: 'Medium - affluent cosmetic patients'
  },
  { 
    name: 'Primary Care Physicians',
    threat: 'Low',
    threatScore: 30,
    criteria: 'Referral gatekeepers - partner opportunity',
    overlap: ['Initial diagnosis', 'Compression therapy'],
    query: 'primary+care+varicose+veins+referral',
    marketGrowth: 'Stable',
    patientSteal: 'Low - mostly refer out'
  },
  { 
    name: 'Interventional Radiology',
    threat: 'Medium',
    threatScore: 50,
    criteria: 'Hospital backing + complex case handling',
    overlap: ['Vein ablation', 'DVT treatment', 'Complex cases'],
    query: 'interventional+radiology+vein+treatment',
    marketGrowth: '+6% YoY',
    patientSteal: 'Medium - hospital-referred patients'
  },
  { 
    name: 'Telehealth Platforms',
    threat: 'Emerging',
    threatScore: 70,
    criteria: 'Convenience + lead capture + growing adoption',
    overlap: ['Initial consultations', 'Follow-up care', 'Lead generation'],
    query: 'telehealth+vein+consultation+OR+virtual+vein+doctor',
    marketGrowth: '+25% YoY',
    patientSteal: 'Rising - capturing first-touch leads'
  }
];

// Main route
app.get('/', async (req, res) => {
  // Fetch all competitor news separately
  const competitorNewsPromises = directCompetitorsList.map(c => 
    fetchUrl(`https://news.google.com/rss/search?q=${c.query}+vein&hl=en-US&gl=US&ceid=US:en`).catch(() => '')
  );
  
  // Fetch state-specific news
  const stateNewsPromises = statesList.map(s =>
    fetchUrl(`https://news.google.com/rss/search?q=(vein+clinic+OR+varicose+veins+OR+vein+treatment)+(${s.query})&hl=en-US&gl=US&ceid=US:en`).catch(() => '')
  );
  
  // Fetch indirect competitor news
  const indirectNewsPromises = indirectCompetitorsDetailed.map(c =>
    fetchUrl(`https://news.google.com/rss/search?q=${c.query}&hl=en-US&gl=US&ceid=US:en`).catch(() => '')
  );
  
  // Fetch industry news
  const industryNewsPromise = fetchUrl('https://news.google.com/rss/search?q=varicose+veins+treatment+OR+spider+veins+OR+vein+clinic&hl=en-US&gl=US&ceid=US:en').catch(() => '');

  try {
    const [industryRaw, ...competitorRaws] = await Promise.all([industryNewsPromise, ...competitorNewsPromises]);
    const stateRaws = await Promise.all(stateNewsPromises);
    const indirectRaws = await Promise.all(indirectNewsPromises);
    
    const industryNews = parseRSS(industryRaw);
    const competitorNews = directCompetitorsList.map((c, i) => ({
      ...c,
      news: parseRSS(competitorRaws[i])
    }));
    const stateNews = statesList.map((s, i) => ({
      ...s,
      news: parseRSS(stateRaws[i])
    }));
    const indirectNews = indirectCompetitorsDetailed.map((c, i) => ({
      ...c,
      news: parseRSS(indirectRaws[i])
    }));

    const html = generateHTML(industryNews, competitorNews, stateNews, indirectNews, metrics);
    res.send(html);
  } catch (e) {
    console.error('Error:', e.message);
    res.status(500).send('Error loading dashboard');
  }
});

function generateHTML(industryNews, competitorNews, stateNews, indirectNews, metrics) {
  const jan = metrics.january;
  const feb = metrics.february;
  
  return `
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
    .container { max-width: 1800px; margin: 0 auto; }
    h1 { text-align: center; font-size: 2rem; margin-bottom: 10px; }
    .subtitle { text-align: center; opacity: 0.7; margin-bottom: 20px; }
    
    /* Controls bar */
    .controls-bar { display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.05); padding: 15px 20px; border-radius: 12px; margin-bottom: 30px; flex-wrap: wrap; gap: 15px; }
    .date-controls { display: flex; align-items: center; gap: 10px; }
    .date-controls label { font-size: 0.85rem; opacity: 0.7; }
    .date-controls select, .date-controls input { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 8px 12px; border-radius: 8px; font-size: 0.85rem; }
    .refresh-controls { display: flex; align-items: center; gap: 15px; }
    .auto-refresh { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; }
    .auto-refresh input[type="checkbox"] { width: 18px; height: 18px; accent-color: #4ade80; }
    .refresh-btn { background: linear-gradient(135deg, #4ade80, #22c55e); border: none; color: #000; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 0.85rem; }
    .refresh-btn:hover { opacity: 0.9; }
    .last-update { font-size: 0.75rem; opacity: 0.5; }
    
    .section { margin-bottom: 40px; }
    .grid { display: grid; gap: 20px; }
    .grid-5 { grid-template-columns: repeat(5, 1fr); }
    .grid-4 { grid-template-columns: repeat(4, 1fr); }
    .grid-3 { grid-template-columns: repeat(3, 1fr); }
    .grid-2 { grid-template-columns: repeat(2, 1fr); }
    .grid-6 { grid-template-columns: repeat(6, 1fr); }
    @media (max-width: 1400px) { .grid-5, .grid-6 { grid-template-columns: repeat(3, 1fr); } }
    @media (max-width: 1200px) { .grid-4, .grid-5, .grid-6 { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 768px) { .grid-4, .grid-3, .grid-2, .grid-5, .grid-6 { grid-template-columns: 1fr; } .controls-bar { flex-direction: column; align-items: stretch; } }
    
    .card { background: rgba(255,255,255,0.05); border-radius: 16px; padding: 20px; border: 1px solid rgba(255,255,255,0.1); }
    .card-title { font-size: 0.85rem; opacity: 0.7; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .card-value { font-size: 2rem; font-weight: 600; margin-bottom: 8px; }
    .card-change { font-size: 0.85rem; }
    .positive { color: #4ade80; }
    .negative { color: #f87171; }
    .neutral { color: #fbbf24; }
    
    .gauge-container { width: 100%; height: 10px; background: rgba(255,255,255,0.1); border-radius: 5px; margin-top: 12px; overflow: hidden; }
    .gauge-fill { height: 100%; border-radius: 5px; }
    .gauge-green { background: linear-gradient(90deg, #4ade80, #22c55e); }
    .gauge-purple { background: linear-gradient(90deg, #a78bfa, #8b5cf6); }
    
    .divider { display: flex; align-items: center; gap: 15px; margin: 30px 0; }
    .divider-line { flex: 1; height: 1px; background: rgba(255,255,255,0.1); }
    .divider-text { font-size: 0.85rem; opacity: 0.7; text-transform: uppercase; letter-spacing: 1px; }
    
    .news-list { max-height: 250px; overflow-y: auto; }
    .news-item { padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .news-item:last-child { border-bottom: none; }
    .news-item a { color: #fff; text-decoration: none; font-size: 0.8rem; line-height: 1.4; }
    .news-item a:hover { color: #06b6d4; }
    .news-date { font-size: 0.7rem; opacity: 0.5; margin-top: 4px; }
    .news-empty { opacity: 0.4; padding: 20px; text-align: center; font-size: 0.8rem; }
    
    .competitor-card { padding: 12px; background: rgba(255,255,255,0.03); border-radius: 10px; margin-bottom: 10px; border-left: 3px solid; }
    .competitor-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .competitor-name { font-weight: 600; font-size: 0.9rem; }
    .threat-badge { display: inline-block; padding: 3px 10px; border-radius: 10px; font-size: 0.7rem; font-weight: 600; }
    .threat-high { background: rgba(239, 68, 68, 0.2); color: #f87171; }
    .threat-medium { background: rgba(251, 191, 36, 0.2); color: #fbbf24; }
    .threat-low { background: rgba(74, 222, 128, 0.2); color: #4ade80; }
    .threat-emerging { background: rgba(139, 92, 246, 0.2); color: #a78bfa; }
    .threat-score { font-size: 1.5rem; font-weight: 700; }
    .competitor-detail { font-size: 0.75rem; opacity: 0.7; margin: 4px 0; }
    .competitor-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
    .competitor-tag { background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 10px; font-size: 0.65rem; }
    
    .insight-box { background: rgba(6, 182, 212, 0.1); border: 1px solid rgba(6, 182, 212, 0.3); padding: 15px; border-radius: 10px; margin-top: 15px; }
    .insight-title { font-size: 0.85rem; font-weight: 600; color: #22d3ee; margin-bottom: 8px; }
    .insight-text { font-size: 0.85rem; opacity: 0.8; line-height: 1.5; }
    
    .chart-container { position: relative; height: 250px; margin-top: 15px; }
    
    .comparison-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .comparison-table th, .comparison-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .comparison-table th { font-weight: 500; opacity: 0.7; font-size: 0.75rem; text-transform: uppercase; }
    .comparison-table td:not(:first-child) { text-align: right; }
    
    .month-badge { display: inline-block; padding: 3px 10px; border-radius: 15px; font-size: 0.75rem; font-weight: 500; }
    .badge-jan { background: #3b82f6; }
    .badge-feb { background: #8b5cf6; }
    
    .tabs { display: flex; gap: 5px; margin-bottom: 15px; flex-wrap: wrap; }
    .tab { padding: 6px 12px; background: rgba(255,255,255,0.1); border-radius: 8px; font-size: 0.75rem; cursor: pointer; border: 1px solid transparent; transition: all 0.2s; }
    .tab:hover { background: rgba(255,255,255,0.15); }
    .tab.active { background: rgba(6,182,212,0.2); border-color: rgba(6,182,212,0.5); color: #22d3ee; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    
    .metric-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 15px; }
    .metric-item { background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; text-align: center; }
    .metric-value { font-size: 1.3rem; font-weight: 600; }
    .metric-label { font-size: 0.7rem; opacity: 0.6; margin-top: 4px; }
    
    .sentiment-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; margin: 10px 0; }
    .sentiment-segment { transition: width 0.3s; }
    
    .refresh-note { text-align: center; opacity: 0.5; font-size: 0.75rem; margin-top: 30px; }
    
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .loading { animation: pulse 1.5s infinite; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 VeinTreatmentClinic Analytics</h1>
    <p class="subtitle">Performance + Social Listening + Competitive Intelligence</p>
    
    <!-- CONTROLS BAR -->
    <div class="controls-bar">
      <div class="date-controls">
        <label>📅 Date Range:</label>
        <select id="dateRange" onchange="handleDateChange()">
          <option value="all">All Time</option>
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
          <option value="jan">January 2026</option>
          <option value="feb">February 2026</option>
          <option value="custom">Custom Range</option>
        </select>
        <input type="date" id="startDate" style="display:none" onchange="handleCustomDate()">
        <span id="dateSeparator" style="display:none">to</span>
        <input type="date" id="endDate" style="display:none" onchange="handleCustomDate()">
      </div>
      <div class="refresh-controls">
        <label class="auto-refresh">
          <input type="checkbox" id="autoRefresh" onchange="toggleAutoRefresh()">
          <span>Auto-refresh (5 min)</span>
        </label>
        <button class="refresh-btn" onclick="refreshDashboard()">🔄 Refresh Now</button>
        <span class="last-update" id="lastUpdate">Last updated: ${new Date().toLocaleString()}</span>
      </div>
    </div>
    
    <!-- SOCIAL LISTENING -->
    <div class="divider">
      <div class="divider-line"></div>
      <div class="divider-text">👂 Social Listening & Industry Intel</div>
      <div class="divider-line"></div>
    </div>
    
    <div class="section">
      <div class="grid grid-2">
        <!-- Industry News -->
        <div class="card" style="border-left: 4px solid #06b6d4;">
          <div class="card-title">🔬 Industry News</div>
          <div class="news-list">
            ${industryNews.length > 0 ? industryNews.map(n => `
              <div class="news-item">
                <a href="${n.link}" target="_blank">${n.title}</a>
                <div class="news-date">${n.date}</div>
              </div>
            `).join('') : '<div class="news-empty">No recent industry news</div>'}
          </div>
        </div>
        
        <!-- Competitor Mentions - Tabbed by Competitor -->
        <div class="card" style="border-left: 4px solid #ec4899;">
          <div class="card-title">📰 Competitor Mentions</div>
          <div class="tabs" id="competitorTabs">
            ${competitorNews.map((c, i) => `<div class="tab ${i === 0 ? 'active' : ''}" onclick="switchTab('competitor', ${i})" style="border-left: 3px solid ${c.color}">${c.name.split(' ')[0]}</div>`).join('')}
          </div>
          ${competitorNews.map((c, i) => `
            <div class="tab-content ${i === 0 ? 'active' : ''}" id="competitor-tab-${i}">
              <div class="news-list">
                ${c.news.length > 0 ? c.news.map(n => `
                  <div class="news-item">
                    <a href="${n.link}" target="_blank">${n.title}</a>
                    <div class="news-date">${n.date}</div>
                  </div>
                `).join('') : '<div class="news-empty">No recent mentions for ${c.name}</div>'}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      
      <!-- Local Market Intel - By State -->
      <div class="card" style="margin-top:20px; border-left: 4px solid #22c55e;">
        <div class="card-title">📍 Local Market Intel - By State</div>
        <div class="tabs" id="stateTabs">
          ${stateNews.map((s, i) => `<div class="tab ${i === 0 ? 'active' : ''}" onclick="switchTab('state', ${i})" style="border-left: 3px solid ${s.color}">${s.abbr}</div>`).join('')}
        </div>
        <div class="grid grid-5" style="margin-top:15px">
          ${stateNews.map((s, i) => `
            <div class="tab-content ${i === 0 ? 'active' : ''}" id="state-tab-${i}" style="grid-column: 1 / -1">
              <h4 style="margin-bottom:10px;color:${s.color}">${s.name}</h4>
              <div class="news-list" style="max-height:200px">
                ${s.news.length > 0 ? s.news.map(n => `
                  <div class="news-item">
                    <a href="${n.link}" target="_blank">${n.title}</a>
                    <div class="news-date">${n.date}</div>
                  </div>
                `).join('') : '<div class="news-empty">No recent vein-related news in ${s.name}</div>'}
              </div>
            </div>
          `).join('')}
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
        <!-- Direct Competitors -->
        <div class="card" style="border-left: 4px solid #3b82f6;">
          <div class="card-title">🏢 Direct Competitors</div>
          ${competitors.directCompetitors.map(c => `
            <div class="competitor-card" style="border-left-color: #3b82f6;">
              <div class="competitor-name">${c.name}</div>
              <div class="competitor-detail">${c.handle} • ${c.locations} locations</div>
              <div class="competitor-detail">${c.focus}</div>
            </div>
          `).join('')}
        </div>
        
        <!-- Indirect Competitors - Enhanced -->
        <div class="card" style="border-left: 4px solid #f59e0b;">
          <div class="card-title">⚠️ Indirect Competitors - Threat Analysis</div>
          <div style="font-size:0.7rem;opacity:0.6;margin-bottom:15px">
            Threat Score based on: Service overlap • Market growth • Patient acquisition risk
          </div>
          ${indirectNews.map(c => `
            <div class="competitor-card" style="border-left-color: ${c.threat === 'High' ? '#ef4444' : c.threat === 'Medium' ? '#f59e0b' : c.threat === 'Emerging' ? '#8b5cf6' : '#22c55e'};">
              <div class="competitor-header">
                <div>
                  <span class="competitor-name">${c.name}</span>
                  <span class="threat-badge threat-${c.threat.toLowerCase()}">${c.threat}</span>
                </div>
                <div class="threat-score" style="color: ${c.threat === 'High' ? '#ef4444' : c.threat === 'Medium' ? '#f59e0b' : c.threat === 'Emerging' ? '#8b5cf6' : '#22c55e'};">${c.threatScore}</div>
              </div>
              <div class="competitor-detail"><strong>Why:</strong> ${c.criteria}</div>
              <div class="competitor-detail"><strong>Growth:</strong> ${c.marketGrowth} | <strong>Risk:</strong> ${c.patientSteal}</div>
              <div class="competitor-tags">
                ${c.overlap.map(o => `<span class="competitor-tag">${o}</span>`).join('')}
              </div>
              ${c.news.length > 0 ? `
                <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.1)">
                  <div style="font-size:0.7rem;opacity:0.5;margin-bottom:5px">Latest mention:</div>
                  <a href="${c.news[0].link}" target="_blank" style="font-size:0.75rem;color:#06b6d4;text-decoration:none">${c.news[0].title.substring(0,80)}...</a>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    </div>
    
    <!-- YOUR PERFORMANCE -->
    <div class="divider">
      <div class="divider-line"></div>
      <div class="divider-text">📈 Your Performance</div>
      <div class="divider-line"></div>
    </div>
    
    <div class="section">
      <div class="grid grid-4">
        <div class="card" style="border-left: 4px solid #4ade80;">
          <div class="card-title">Impressions</div>
          <div class="card-value">${((jan.impressions + feb.impressions) / 1000000).toFixed(1)}M</div>
          <div class="card-change ${pctChange(feb.impressions, jan.impressions) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.impressions, jan.impressions) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.impressions, jan.impressions))}% MoM</div>
          <div class="gauge-container"><div class="gauge-fill gauge-green" style="width: ${gauge(jan.impressions + feb.impressions, 30000000)}%"></div></div>
        </div>
        <div class="card" style="border-left: 4px solid #4ade80;">
          <div class="card-title">Engagements</div>
          <div class="card-value">${(jan.engagements + feb.engagements).toLocaleString()}</div>
          <div class="card-change ${pctChange(feb.engagements, jan.engagements) >= 0 ? 'positive' : 'negative'}">${pctChange(feb.engagements, jan.engagements) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.engagements, jan.engagements))}% MoM</div>
          <div class="gauge-container"><div class="gauge-fill gauge-green" style="width: ${gauge(jan.engagements + feb.engagements, 2000)}%"></div></div>
        </div>
        <div class="card" style="border-left: 4px solid #8b5cf6;">
          <div class="card-title">Engagement Rate</div>
          <div class="card-value">${avgEngRate}%</div>
          <div class="card-change" style="opacity:0.7">Industry avg: 1-3%</div>
          <div class="gauge-container"><div class="gauge-fill gauge-purple" style="width: ${Math.min(100, parseFloat(avgEngRate) * 33)}%"></div></div>
        </div>
        <div class="card" style="border-left: 4px solid #4ade80;">
          <div class="card-title">Audience</div>
          <div class="card-value">${((feb.audienceEnd || 28475) / 1000).toFixed(1)}K</div>
          <div class="card-change positive">+${(jan.audienceGrowth + feb.audienceGrowth).toLocaleString()} growth</div>
          <div class="gauge-container"><div class="gauge-fill gauge-green" style="width: ${gauge(feb.audienceEnd || 28475, 50000)}%"></div></div>
        </div>
      </div>
    </div>
    
    <!-- CONTENT & ENGAGEMENT ANALYSIS -->
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
          <div class="card-title">Engagement Breakdown <span style="color:#f59e0b">ANALYSIS</span></div>
          <div class="metric-grid">
            <div class="metric-item">
              <div class="metric-value" style="color:#4ade80">${jan.reactions + feb.reactions}</div>
              <div class="metric-label">Total Reactions</div>
              <div style="font-size:0.7rem;color:#4ade80">${pctChange(feb.reactions, jan.reactions) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.reactions, jan.reactions))}% MoM</div>
            </div>
            <div class="metric-item">
              <div class="metric-value" style="color:#60a5fa">${jan.comments + feb.comments}</div>
              <div class="metric-label">Total Comments</div>
              <div style="font-size:0.7rem;color:#60a5fa">${pctChange(feb.comments, jan.comments) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.comments, jan.comments))}% MoM</div>
            </div>
            <div class="metric-item">
              <div class="metric-value" style="color:#f59e0b">${jan.shares + feb.shares}</div>
              <div class="metric-label">Total Shares</div>
              <div style="font-size:0.7rem;color:#f59e0b">${pctChange(feb.shares, jan.shares) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.shares, jan.shares))}% MoM</div>
            </div>
            <div class="metric-item">
              <div class="metric-value" style="color:#ec4899">${jan.saves + feb.saves}</div>
              <div class="metric-label">Total Saves</div>
              <div style="font-size:0.7rem;color:#ec4899">${pctChange(feb.saves, jan.saves) >= 0 ? '↑' : '↓'} ${Math.abs(pctChange(feb.saves, jan.saves))}% MoM</div>
            </div>
          </div>
          <div class="insight-box" style="margin-top:10px">
            <div class="insight-title">📊 Engagement Quality Score</div>
            <div style="display:flex;align-items:center;gap:15px;margin-top:10px">
              <div style="font-size:2rem;font-weight:700;color:#4ade80">${Math.round(((jan.shares + feb.shares + jan.saves + feb.saves) / (jan.engagements + feb.engagements)) * 100)}%</div>
              <div style="font-size:0.8rem;opacity:0.7">High-value engagements (saves + shares) as % of total. Higher = more valuable audience actions.</div>
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
    
    <!-- KEYWORD INTELLIGENCE -->
    <div class="divider">
      <div class="divider-line"></div>
      <div class="divider-text">🔍 Keyword Intelligence</div>
      <div class="divider-line"></div>
    </div>
    
    <div class="section">
      <div class="card">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:15px;margin-bottom:25px">
          <div style="background:rgba(239,68,68,0.1);padding:15px;border-radius:10px;text-align:center;border:1px solid rgba(239,68,68,0.3)">
            <div style="font-size:1.8rem;font-weight:700;color:#ef4444">${((competitors.keywordClusters.reduce((sum, c) => sum + c.keywords.reduce((s, k) => s + k.volume, 0), 0)) / 1000000).toFixed(1)}M</div>
            <div style="font-size:0.75rem;opacity:0.7">Total Search Volume/mo</div>
          </div>
          <div style="background:rgba(139,92,246,0.1);padding:15px;border-radius:10px;text-align:center;border:1px solid rgba(139,92,246,0.3)">
            <div style="font-size:1.8rem;font-weight:700;color:#8b5cf6">${competitors.keywordClusters.reduce((sum, c) => sum + c.keywords.length, 0)}</div>
            <div style="font-size:0.75rem;opacity:0.7">Keywords Tracked</div>
          </div>
          <div style="background:rgba(34,197,94,0.1);padding:15px;border-radius:10px;text-align:center;border:1px solid rgba(34,197,94,0.3)">
            <div style="font-size:1.8rem;font-weight:700;color:#22c55e">${competitors.keywordClusters.reduce((sum, c) => sum + c.keywords.filter(k => k.trend === 'up').length, 0)}</div>
            <div style="font-size:0.75rem;opacity:0.7">Trending Up ↑</div>
          </div>
          <div style="background:rgba(6,182,212,0.1);padding:15px;border-radius:10px;text-align:center;border:1px solid rgba(6,182,212,0.3)">
            <div style="font-size:1.8rem;font-weight:700;color:#06b6d4">${competitors.keywordClusters.reduce((sum, c) => sum + c.keywords.filter(k => k.intent === 'transactional').length, 0)}</div>
            <div style="font-size:0.75rem;opacity:0.7">High-Intent Keywords</div>
          </div>
        </div>
        
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:20px">
          ${competitors.keywordClusters.map(cluster => `
            <div style="background:rgba(255,255,255,0.03);border-radius:12px;padding:15px;border-left:4px solid ${cluster.color}">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                <div style="font-weight:600;font-size:0.95rem">${cluster.icon} ${cluster.name}</div>
                <div style="font-size:0.7rem;opacity:0.6">${(cluster.keywords.reduce((s, k) => s + k.volume, 0) / 1000).toFixed(0)}K vol/mo</div>
              </div>
              <div style="display:flex;flex-direction:column;gap:6px">
                ${cluster.keywords.sort((a, b) => b.volume - a.volume).slice(0, 5).map(kw => `
                  <div style="display:flex;align-items:center;gap:8px;font-size:0.8rem">
                    <div style="flex:1;display:flex;align-items:center;gap:6px">
                      <span style="opacity:0.9">${kw.term}</span>
                      ${kw.trend === 'up' ? '<span style="color:#22c55e;font-size:0.7rem">↑</span>' : ''}
                    </div>
                    <div style="display:flex;gap:4px;align-items:center">
                      <span style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:8px;font-size:0.65rem;min-width:45px;text-align:right">${kw.volume >= 100000 ? (kw.volume / 1000).toFixed(0) + 'K' : kw.volume >= 1000 ? (kw.volume / 1000).toFixed(1) + 'K' : kw.volume}</span>
                      <span style="padding:2px 5px;border-radius:6px;font-size:0.6rem;${kw.intent === 'transactional' ? 'background:rgba(34,197,94,0.2);color:#4ade80' : kw.intent === 'urgent' ? 'background:rgba(239,68,68,0.2);color:#f87171' : 'background:rgba(96,165,250,0.2);color:#60a5fa'}">${kw.intent === 'transactional' ? '💰' : kw.intent === 'urgent' ? '🚨' : 'ℹ️'}</span>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
    
    <p class="refresh-note" id="refreshNote">Data: Jan 1 - Feb 27, 2026 • @veintreatmentclinic • Last updated: <span id="updateTime">${new Date().toLocaleString()}</span></p>
  </div>
  
  <script>
    // Chart data
    const dailyData = ${JSON.stringify(metrics.daily)};
    
    // Initialize charts
    new Chart(document.getElementById('engRateChart'), {
      type: 'line', 
      data: { 
        labels: dailyData.filter(d => d.engagementRate > 0).map(d => d.date), 
        datasets: [{ 
          label: 'Eng Rate %', 
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
          x: { ticks: { color: '#888', maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.05)' } }, 
          y: { ticks: { color: '#8b5cf6' }, grid: { color: 'rgba(255,255,255,0.05)' } } 
        } 
      }
    });
    
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
          tension: 0.4 
        }] 
      },
      options: { 
        responsive: true, 
        maintainAspectRatio: false, 
        plugins: { legend: { labels: { color: '#fff' } } }, 
        scales: { 
          x: { ticks: { color: '#888', maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.05)' } }, 
          y: { ticks: { color: '#4ade80' }, grid: { color: 'rgba(255,255,255,0.05)' } } 
        } 
      }
    });
    
    // Tab switching
    function switchTab(type, index) {
      const tabs = document.querySelectorAll(\`#\${type}Tabs .tab\`);
      const contents = document.querySelectorAll(\`[id^="\${type}-tab-"]\`);
      tabs.forEach((t, i) => t.classList.toggle('active', i === index));
      contents.forEach((c, i) => c.classList.toggle('active', i === index));
    }
    
    // Date range handling
    function handleDateChange() {
      const select = document.getElementById('dateRange');
      const startInput = document.getElementById('startDate');
      const endInput = document.getElementById('endDate');
      const separator = document.getElementById('dateSeparator');
      
      if (select.value === 'custom') {
        startInput.style.display = 'inline-block';
        endInput.style.display = 'inline-block';
        separator.style.display = 'inline';
      } else {
        startInput.style.display = 'none';
        endInput.style.display = 'none';
        separator.style.display = 'none';
        // In a real app, this would filter/reload data
        console.log('Date range changed to:', select.value);
      }
    }
    
    function handleCustomDate() {
      const start = document.getElementById('startDate').value;
      const end = document.getElementById('endDate').value;
      if (start && end) {
        console.log('Custom date range:', start, 'to', end);
        // In a real app, this would filter/reload data
      }
    }
    
    // Auto-refresh
    let refreshInterval = null;
    function toggleAutoRefresh() {
      const checkbox = document.getElementById('autoRefresh');
      if (checkbox.checked) {
        refreshInterval = setInterval(refreshDashboard, 5 * 60 * 1000); // 5 minutes
        console.log('Auto-refresh enabled');
      } else {
        clearInterval(refreshInterval);
        refreshInterval = null;
        console.log('Auto-refresh disabled');
      }
    }
    
    function refreshDashboard() {
      document.getElementById('updateTime').textContent = 'Refreshing...';
      document.getElementById('updateTime').classList.add('loading');
      
      // Reload the page
      setTimeout(() => {
        location.reload();
      }, 500);
    }
  </script>
</body>
</html>`;
}

app.listen(PORT, () => console.log(`Dashboard running on port ${PORT}`));
