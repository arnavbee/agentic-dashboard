// Application State
let allFeedItems = [];
let filteredFeedItems = [];
let activeCategory = 'all';
let activeKeyword = null;
let searchQuery = '';
let activeTimeWindow = 'all';
let selectedId = null;

// Auto-Refresh Configuration
const CACHE_DURATION_SEC = 15 * 60; // 15 minutes
let countdownSeconds = CACHE_DURATION_SEC;
let countdownTimer = null;

// Category ACCENT Tag Mapping
const CAT_TAGS = {
  'cs.MA': ['tag-ma', 'cs.MA'],
  'cs.AI': ['tag-ai', 'cs.AI'],
  'cs.CL': ['tag-cl', 'cs.CL'],
  'cs.LG': ['tag-lg', 'cs.LG'],
  'cs.SE': ['tag-se', 'cs.SE'],
  'industry-news': ['tag-industry', 'Industry']
};

// Main Fetch Feed Controller
async function fetchFeedData(force = false) {
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) refreshBtn.classList.add('spinning');
  
  const feedContent = document.getElementById('feed-content');
  if (allFeedItems.length === 0) {
    feedContent.innerHTML = `
      <div class="loading-state">
        <div class="loader-grid">
          ${Array(8).fill('<div class="loader-cell"></div>').join('')}
        </div>
        <div class="loading-text">SYNCING WITH EMBEDDED AGENTIC DATABASE SERVER...</div>
      </div>`;
  }

  try {
    const url = force ? '/api/feed?refresh=true' : '/api/feed';
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
    
    const result = await response.json();
    
    if (result.status === 'success') {
      allFeedItems = result.data || [];
      
      // Update indicators
      updateLastUpdatedTime(result.timestamp);
      updateCacheStatus(result.source);
      updateCategoryCounts();
      updateStatsPanel();
      applyFilters();
      
      // Automatically select first item if none is selected
      if (allFeedItems.length > 0 && !selectedId) {
        const firstItem = allFeedItems[0];
        selectFeedItem(firstItem.arxivId || firstItem.link);
      }
      
      // Reset countdown
      resetCountdown();
    } else {
      throw new Error(result.message || 'Unknown response error');
    }
  } catch (err) {
    console.error('Fetch Feed Failed:', err);
    feedContent.innerHTML = `
      <div class="error-state">
        <div style="font-size: 14px; font-weight: bold; margin-bottom: 8px;">⚠ PIPELINE CONNECTION FAILURE</div>
        <div style="font-size: 11px; color: var(--text-dim); margin-bottom: 16px;">${escapeHtml(err.message)}</div>
        <button class="open-btn" onclick="fetchFeedData(true)" style="max-width: 200px; margin: 0 auto;">Retry Pipeline Connection</button>
      </div>`;
  } finally {
    if (refreshBtn) refreshBtn.classList.remove('spinning');
  }
}

// Update clock
function updateLastUpdatedTime(timestampIso) {
  const dateObj = timestampIso ? new Date(timestampIso) : new Date();
  const timeStr = dateObj.toUTCString().split(' ')[4] + ' UTC';
  document.getElementById('last-updated').textContent = timeStr;
}

// Update cache status
function updateCacheStatus(sourceType) {
  const cacheVal = document.getElementById('stat-cache-status');
  if (sourceType === 'cache' || sourceType === 'cache_retained') {
    cacheVal.textContent = 'CACHED';
    cacheVal.style.color = 'var(--indigo)';
  } else {
    cacheVal.textContent = 'FRESH';
    cacheVal.style.color = 'var(--violet)';
  }
}

// Update sidebar counters
function updateCategoryCounts() {
  document.getElementById('count-all').textContent = allFeedItems.length;
  
  const categories = ['cs.MA', 'cs.AI', 'cs.CL', 'cs.LG', 'cs.SE', 'industry-news', 'self-improving'];
  categories.forEach(cat => {
    let count = 0;
    if (cat === 'industry-news') {
      count = allFeedItems.filter(item => item.cats.includes('industry-news') || item.source !== 'arXiv').length;
      document.getElementById('count-industry').textContent = count;
    } else if (cat === 'self-improving') {
      count = allFeedItems.filter(item => {
        const matchText = (item.title + ' ' + item.summary).toLowerCase();
        return matchText.includes('self-improving') || matchText.includes('self-improvement') || matchText.includes('self-correction');
      }).length;
      document.getElementById('count-self-improving').textContent = count;
    } else {
      count = allFeedItems.filter(item => item.cats.includes(cat)).length;
      const elId = 'count-' + cat.split('.')[1];
      const el = document.getElementById(elId);
      if (el) el.textContent = count;
    }
  });

  const keywords = ['reasoning', 'planning', 'tool', 'multi-agent', 'memory', 'safety', 'self-improving'];
  keywords.forEach(kw => {
    const count = allFeedItems.filter(item => {
      const matchText = (item.title + ' ' + item.summary).toLowerCase();
      return matchText.includes(kw);
    }).length;
    // Special check for Tool keyword to map to UI element Tool-use
    const elId = kw === 'tool' ? 'kw-tool' : 'kw-' + kw;
    const el = document.getElementById(elId);
    if (el) el.textContent = count;
  });
}

// Update stats bar
function updateStatsPanel() {
  document.getElementById('stat-count').textContent = allFeedItems.length;
  document.getElementById('stat-sub').textContent = `Aggregated Items`;
  
  if (allFeedItems.length > 0) {
    const latestItem = allFeedItems[0];
    document.getElementById('stat-latest').textContent = formatDateRelative(latestItem.published);
  }
}

// Apply current filters
function applyFilters() {
  let items = [...allFeedItems];

  // 0. Time Window Filter
  if (activeTimeWindow !== 'all') {
    const now = new Date();
    const cutoffDate = new Date();
    const days = parseInt(activeTimeWindow);
    if (!isNaN(days)) {
      cutoffDate.setDate(now.getDate() - days);
      items = items.filter(item => {
        const pubDate = new Date(item.published);
        return !isNaN(pubDate) && pubDate >= cutoffDate;
      });
    }
  }

  // 1. Category Filter
  if (activeCategory !== 'all') {
    if (activeCategory === 'industry-news') {
      items = items.filter(item => item.cats.includes('industry-news') || item.source !== 'arXiv');
    } else if (activeCategory === 'self-improving') {
      items = items.filter(item => {
        const matchText = (item.title + ' ' + item.summary).toLowerCase();
        return matchText.includes('self-improving') || matchText.includes('self-improvement') || matchText.includes('self-correction');
      });
    } else {
      items = items.filter(item => item.cats.includes(activeCategory));
    }
  }

  // 2. Keyword Filter
  if (activeKeyword) {
    items = items.filter(item => {
      const matchText = (item.title + ' ' + item.summary).toLowerCase();
      return matchText.includes(activeKeyword);
    });
  }

  // 3. Search Query Filter
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    items = items.filter(item => {
      const titleMatch = item.title.toLowerCase().includes(q);
      const summaryMatch = item.summary.toLowerCase().includes(q);
      const authorMatch = item.authors.some(auth => auth.toLowerCase().includes(q));
      return titleMatch || summaryMatch || authorMatch;
    });
  }

  filteredFeedItems = items;

  const activeLabel = activeKeyword ? activeKeyword.toUpperCase() : (activeCategory === 'all' ? 'ALL TOPICS' : activeCategory.toUpperCase());
  document.getElementById('stat-filter').textContent = activeLabel;
  document.getElementById('stat-filtered').textContent = `Showing ${filteredFeedItems.length} matching`;

  renderFeedList();
  if (activeView === 'chart') {
    renderTrendChart();
  }
}

// Render feed list
function renderFeedList() {
  const container = document.getElementById('feed-content');
  
  if (filteredFeedItems.length === 0) {
    container.innerHTML = `
      <div class="no-results">
        NO PIPELINE RECORDS MATCHED YOUR SELECTION CRITERIA
      </div>`;
    return;
  }

  const html = filteredFeedItems.map((item, idx) => {
    const primaryCat = determinePrimaryCategory(item.cats, item.source);
    const [tagClass, label] = CAT_TAGS[primaryCat] || ['tag-ma', primaryCat];
    
    const extraCats = item.cats.filter(c => c !== primaryCat && CAT_TAGS[c]).slice(0, 2);
    const extraTagsHtml = extraCats.map(c => {
      const [tc, lbl] = CAT_TAGS[c];
      return `<span class="paper-tag ${tc}">${lbl}</span>`;
    }).join('');

    // Check if paper contains self-improving agent context to append as an addition tag (not primary identity)
    const isSelfImproving = (item.title + ' ' + item.summary).toLowerCase().match(/self-improving|self-improvement|self-correction/);
    const selfImprovingTag = isSelfImproving ? `<span class="paper-tag tag-ai" style="border-color: var(--cyan); background: var(--cyan-dim); color: var(--cyan)">Self-Improving</span>` : '';

    const uniqueId = item.arxivId || item.link;
    const isSelected = uniqueId === selectedId;

    return `
      <div class="paper-card ${isSelected ? 'selected' : ''}" 
           onclick="selectFeedItem('${uniqueId}')"
           style="animation-delay: ${idx * 0.02}s">
        <div class="paper-meta">
          <span class="paper-id">${item.arxivId ? `arXiv:${item.arxivId}` : item.source.toUpperCase()}</span>
          <span class="paper-tag ${tagClass}">${label}</span>
          ${extraTagsHtml}
          ${selfImprovingTag}
          <span class="paper-date">${formatDateRelative(item.published)}</span>
        </div>
        <div class="paper-title">${escapeHtml(item.title)}</div>
        <div class="paper-authors">${escapeHtml(item.authors.slice(0, 4).join(', '))}${item.authors.length > 4 ? ` +${item.authors.length - 4} more` : ''}</div>
        <div class="paper-abstract">${escapeHtml(item.summary)}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

// Select item to view details
function selectFeedItem(uniqueId) {
  selectedId = uniqueId;
  
  document.querySelectorAll('.paper-card').forEach(card => {
    const clickAttr = card.getAttribute('onclick');
    if (clickAttr && clickAttr.includes(uniqueId)) {
      card.classList.add('selected');
    } else {
      card.classList.remove('selected');
    }
  });

  const item = allFeedItems.find(i => (i.arxivId === uniqueId || i.link === uniqueId));
  if (!item) return;

  const detailContainer = document.getElementById('detail-content');
  let tagsHtml = item.cats.filter(c => CAT_TAGS[c]).map(c => {
    const [cls, lbl] = CAT_TAGS[c];
    return `<span class="paper-tag ${cls}">${lbl}</span>`;
  }).join('');

  // Check if paper contains self-improving agent context to append as an addition tag (not primary identity)
  const isSelfImproving = (item.title + ' ' + item.summary).toLowerCase().match(/self-improving|self-improvement|self-correction/);
  if (isSelfImproving) {
    tagsHtml += `<span class="paper-tag tag-ai" style="border-color: var(--cyan); background: var(--cyan-dim); color: var(--cyan)">Self-Improving</span>`;
  }

  const pdfButtonHtml = item.pdfLink 
    ? `<a href="${item.pdfLink}" target="_blank" class="abs-btn">↓ DOWNLOAD PDF SPEC</a>` 
    : `<button class="abs-btn" disabled style="opacity: 0.5; cursor: not-allowed;">↓ NO PDF AVAILABLE</button>`;

  detailContainer.innerHTML = `
    <div class="detail-body">
      <div class="detail-tags">${tagsHtml}</div>
      <div class="detail-title">${escapeHtml(item.title)}</div>
      <div class="detail-authors">${escapeHtml(item.authors.join(' · '))}</div>
      
      <div class="detail-date-row">
        <div class="detail-date-cell">
          <div class="label">PUBLISHED / ACQUIRED</div>
          <div class="value">${formatDateFull(item.published)}</div>
        </div>
        <div class="detail-date-cell">
          <div class="label">FEED SOURCE</div>
          <div class="value" style="color: var(--violet); font-weight: bold;">${escapeHtml(item.source)}</div>
        </div>
      </div>

      <div class="detail-section-label">ABSTRACT / TRANSCRIPT</div>
      <div class="detail-abstract">${escapeHtml(item.summary)}</div>

      <div class="action-buttons">
        <a href="${item.link}" target="_blank" class="open-btn">↗ OPEN REMOTE SOURCE</a>
        ${pdfButtonHtml}
      </div>
    </div>
  `;
}

// Helpers
function determinePrimaryCategory(cats, source) {
  if (source !== 'arXiv') return 'industry-news';
  const order = ['cs.MA', 'cs.AI', 'cs.CL', 'cs.LG', 'cs.SE'];
  for (const o of order) {
    if (cats.includes(o)) return o;
  }
  return cats[0] || 'cs.MA';
}

function setCategory(cat, el) {
  activeCategory = cat;
  activeKeyword = null;
  
  document.querySelectorAll('.sidebar [data-cat]').forEach(e => e.classList.remove('active'));
  document.querySelectorAll('.sidebar [data-kw]').forEach(e => e.classList.remove('active'));
  
  el.classList.add('active');
  
  const label = cat === 'all' ? 'LATEST ENTRIES' : (cat === 'industry-news' ? 'INDUSTRY ARTICLES' : `TOPIC: ${cat.toUpperCase()}`);
  document.getElementById('feed-title-label').textContent = label;
  
  applyFilters();
}

function setKeyword(kw, el) {
  if (activeKeyword === kw) {
    activeKeyword = null;
    el.classList.remove('active');
  } else {
    activeKeyword = kw;
    activeCategory = 'all';
    
    document.querySelectorAll('.sidebar [data-cat]').forEach(e => e.classList.remove('active'));
    document.querySelectorAll('.sidebar [data-kw]').forEach(e => e.classList.remove('active'));
    
    const allTopicsEl = document.querySelector('.sidebar [data-cat="all"]');
    if (allTopicsEl) allTopicsEl.classList.add('active');
    
    el.classList.add('active');
  }
  
  applyFilters();
}

function onSearch() {
  searchQuery = document.getElementById('search-input').value;
  applyFilters();
}

function formatDateFull(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateRelative(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  const now = new Date();
  const diff = now - d;
  
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (hours < 0) return 'Just now';
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return formatDateFull(isoString);
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function resetCountdown() {
  countdownSeconds = CACHE_DURATION_SEC;
  if (countdownTimer) clearInterval(countdownTimer);
  
  countdownTimer = setInterval(() => {
    countdownSeconds--;
    if (countdownSeconds <= 0) {
      clearInterval(countdownTimer);
      fetchFeedData(false);
    } else {
      const minutes = Math.floor(countdownSeconds / 60);
      const secs = countdownSeconds % 60;
      document.getElementById('stat-next').textContent = `countdown: ${minutes}m ${secs}s`;
    }
  }, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
  fetchFeedData(false);
});

// Chart View & Data Controllers
let activeView = 'feed';
let trendChartInstance = null;
let maxTrendChartInstance = null;
let chartActiveKeywords = ['reasoning', 'planning', 'self-improving']; // Start with these three active

const keywordsList = ['reasoning', 'planning', 'tool', 'multi-agent', 'memory', 'safety', 'self-improving'];
const keywordLabels = {
  'reasoning': 'Reasoning',
  'planning': 'Planning',
  'tool': 'Tool-Use',
  'multi-agent': 'Multi-Agent',
  'memory': 'Memory',
  'safety': 'Safety',
  'self-improving': 'Self-Improving'
};

function switchView(view) {
  activeView = view;
  const feedContent = document.getElementById('feed-content');
  const chartContainer = document.getElementById('chart-view-container');
  const feedTabBtn = document.getElementById('tab-btn-feed');
  const chartTabBtn = document.getElementById('tab-btn-chart');

  if (view === 'feed') {
    feedContent.style.display = 'block';
    chartContainer.style.display = 'none';
    feedTabBtn.classList.add('active');
    chartTabBtn.classList.remove('active');
  } else {
    feedContent.style.display = 'none';
    chartContainer.style.display = 'flex';
    feedTabBtn.classList.remove('active');
    chartTabBtn.classList.add('active');
    renderTrendChart();
  }
}

function getMonday(d) {
  d = new Date(d);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function generateChartData() {
  const weeksMap = {};

  filteredFeedItems.forEach(item => {
    const pubDate = new Date(item.published);
    if (isNaN(pubDate)) return;
    const mon = getMonday(pubDate);
    const monKey = mon.toISOString().split('T')[0]; // YYYY-MM-DD

    if (!weeksMap[monKey]) {
      weeksMap[monKey] = {
        date: mon,
        counts: {
          'reasoning': 0,
          'planning': 0,
          'tool': 0,
          'multi-agent': 0,
          'memory': 0,
          'safety': 0,
          'self-improving': 0
        }
      };
    }

    const matchText = (item.title + ' ' + item.summary).toLowerCase();
    keywordsList.forEach(kw => {
      if (matchText.includes(kw)) {
        weeksMap[monKey].counts[kw]++;
      }
    });
  });

  // Sort weeks chronologically
  const sortedWeekKeys = Object.keys(weeksMap).sort();
  
  // Format labels: "May 12, 26"
  const labels = sortedWeekKeys.map(k => {
    const d = weeksMap[k].date;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  });

  const datasets = {
    'reasoning': [],
    'planning': [],
    'tool': [],
    'multi-agent': [],
    'memory': [],
    'safety': [],
    'self-improving': []
  };

  sortedWeekKeys.forEach(k => {
    const counts = weeksMap[k].counts;
    keywordsList.forEach(kw => {
      datasets[kw].push(counts[kw]);
    });
  });

  return { labels, datasets };
}

function renderCustomLegendPills() {
  const containers = [
    document.getElementById('chart-legend-pills'),
    document.getElementById('modal-chart-legend-pills')
  ];

  containers.forEach(container => {
    if (!container) return;

    const pillsHtml = keywordsList.map(kw => {
      const isActive = chartActiveKeywords.includes(kw);
      const label = keywordLabels[kw];
      return `
        <button class="legend-pill ${kw} ${isActive ? 'active' : ''}" 
                onclick="toggleKeywordDataset('${kw}')">
          ${isActive ? '●' : '○'} ${label}
        </button>
      `;
    }).join('');

    container.innerHTML = pillsHtml;
  });
}

function toggleKeywordDataset(kw) {
  const index = chartActiveKeywords.indexOf(kw);
  if (index > -1) {
    if (chartActiveKeywords.length > 1) { // Keep at least one trend active
      chartActiveKeywords.splice(index, 1);
    }
  } else {
    chartActiveKeywords.push(kw);
  }
  
  renderCustomLegendPills();
  renderTrendChart();
  
  if (document.getElementById('chart-modal').style.display !== 'none') {
    renderMaximizedTrendChart();
  }
}

function renderTrendChart() {
  const canvas = document.getElementById('trendChart');
  if (!canvas) return;

  const { labels, datasets } = generateChartData();

  if (trendChartInstance) {
    trendChartInstance.destroy();
  }

  renderCustomLegendPills();

  const datasetColors = {
    'reasoning': '#b388ff',      // Violet
    'planning': '#00e5ff',       // Cyan
    'tool': '#8c9eff',           // Indigo
    'multi-agent': '#ff1744',    // Crimson
    'memory': '#ff4081',         // Magenta
    'safety': '#eceff1',         // Silver/White
    'self-improving': '#ab47bc'   // Deep Purple
  };

  // Filter datasets to only render the active keyword trendlines
  const chartDatasets = chartActiveKeywords.map(kw => {
    return {
      label: keywordLabels[kw],
      data: datasets[kw] || [],
      borderColor: datasetColors[kw],
      backgroundColor: datasetColors[kw] + '15',
      borderWidth: 2,
      tension: 0.3,
      pointRadius: 4,
      pointHoverRadius: 6,
      fill: false
    };
  });

  trendChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: chartDatasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }, // Hide default legend to use custom pills
        tooltip: {
          backgroundColor: '#0c0a13',
          titleColor: '#b388ff',
          bodyColor: '#e8e5f0',
          titleFont: { family: 'IBM Plex Mono' },
          bodyFont: { family: 'IBM Plex Mono' },
          borderColor: '#1a142e',
          borderWidth: 1
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(49, 27, 94, 0.15)'
          },
          ticks: {
            color: '#9c97b8',
            font: { family: 'IBM Plex Mono', size: 9 }
          }
        },
        y: {
          grid: {
            color: 'rgba(49, 27, 94, 0.15)'
          },
          ticks: {
            color: '#9c97b8',
            precision: 0,
            font: { family: 'IBM Plex Mono', size: 9 }
          }
        }
      }
    }
  });
}

function renderMaximizedTrendChart() {
  const canvas = document.getElementById('maxTrendChart');
  if (!canvas) return;

  const { labels, datasets } = generateChartData();

  if (maxTrendChartInstance) {
    maxTrendChartInstance.destroy();
  }

  const datasetColors = {
    'reasoning': '#b388ff',      // Violet
    'planning': '#00e5ff',       // Cyan
    'tool': '#8c9eff',           // Indigo
    'multi-agent': '#ff1744',    // Crimson
    'memory': '#ff4081',         // Magenta
    'safety': '#eceff1',         // Silver/White
    'self-improving': '#ab47bc'   // Deep Purple
  };

  const chartDatasets = chartActiveKeywords.map(kw => {
    return {
      label: keywordLabels[kw],
      data: datasets[kw] || [],
      borderColor: datasetColors[kw],
      backgroundColor: datasetColors[kw] + '10',
      borderWidth: 3, // Thicker lines in fullscreen
      tension: 0.35,
      pointRadius: 5,
      pointHoverRadius: 8,
      fill: false
    };
  });

  maxTrendChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: chartDatasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0c0a13',
          titleColor: '#b388ff',
          bodyColor: '#e8e5f0',
          titleFont: { family: 'IBM Plex Mono', size: 11 },
          bodyFont: { family: 'IBM Plex Mono', size: 11 },
          borderColor: '#1a142e',
          borderWidth: 1
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(49, 27, 94, 0.15)' },
          ticks: {
            color: '#9c97b8',
            font: { family: 'IBM Plex Mono', size: 10 }
          }
        },
        y: {
          grid: { color: 'rgba(49, 27, 94, 0.15)' },
          ticks: {
            color: '#9c97b8',
            precision: 0,
            font: { family: 'IBM Plex Mono', size: 10 }
          }
        }
      }
    }
  });
}

function toggleMaximizeChart(isOpen) {
  const modal = document.getElementById('chart-modal');
  if (!modal) return;

  if (isOpen) {
    modal.style.display = 'flex';
    renderCustomLegendPills();
    renderMaximizedTrendChart();
  } else {
    modal.style.display = 'none';
    if (maxTrendChartInstance) {
      maxTrendChartInstance.destroy();
      maxTrendChartInstance = null;
    }
  }
}

function setTimeWindow(val) {
  activeTimeWindow = val;
  applyFilters();
}

function exportToCSV() {
  const { labels, datasets } = generateChartData();
  if (labels.length === 0) {
    alert("No data available to export.");
    return;
  }

  // Build CSV pivoted layout (columns: Week, Keyword1, Keyword2, ...)
  const headers = ['Week', ...keywordsList.map(kw => keywordLabels[kw] || kw)];
  let csvRows = [headers.join(',')];

  labels.forEach((label, idx) => {
    const row = [
      `"${label}"`,
      ...keywordsList.map(kw => datasets[kw][idx] || 0)
    ];
    csvRows.push(row.join(','));
  });

  const csvContent = csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);

  const projectName = document.title.includes("Physical") ? "physical-ai" : "agentic-ai";
  link.setAttribute("download", `${projectName}_trends_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

