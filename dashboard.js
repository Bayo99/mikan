const browserAPI = typeof browser !== 'undefined' ? browser : chrome;
let watchData = {};
let darkModeEnabled = false;

const isExtension = typeof browserAPI !== 'undefined' && browserAPI.storage && browserAPI.storage.local;

function formatTime(seconds) {
  seconds = Math.floor(seconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  } else {
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
}

function formatTimeHours(seconds) {
  const hours = seconds / 3600;
  if (hours >= 1) {
    return `${hours.toFixed(1)}h`;
  } else {
    return `${Math.floor(seconds / 60)}m`;
  }
}

function formatTimeVerbose(seconds) {
  seconds = Math.floor(seconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes} minutes`;
  } else {
    return `${seconds} seconds`;
  }
}

function getDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getWeekStart() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  return getDateString(new Date(now.getFullYear(), now.getMonth(), diff));
}

function getMonthStart() {
  const now = new Date();
  return getDateString(new Date(now.getFullYear(), now.getMonth(), 1));
}

function updateDarkModeUI() {
  const btn = document.getElementById('dark-mode-btn');
  if (darkModeEnabled) {
    document.body.classList.add('dark-mode');
    btn.textContent = '☀️';
    btn.title = 'Switch to light mode';
  } else {
    document.body.classList.remove('dark-mode');
    btn.textContent = '🌙';
    btn.title = 'Switch to dark mode';
  }
  
  // Rebuild heatmap to apply correct empty color
  if (calHeatmap) {
    buildHeatmap();
  }
}

function calculateStats() {
  const today = getDateString(new Date());
  const weekStart = getWeekStart();
  const monthStart = getMonthStart();
  
  let todaySeconds = 0;
  let weekSeconds = 0;
  let monthSeconds = 0;
  let totalSeconds = 0;
  
  const days = Object.keys(watchData);
  const daysWithData = days.filter(d => watchData[d] && watchData[d].totalSeconds > 0);
  
  for (const day of days) {
    const seconds = watchData[day]?.totalSeconds || 0;
    totalSeconds += seconds;
    
    if (day === today) {
      todaySeconds = seconds;
    }
    if (day >= weekStart) {
      weekSeconds += seconds;
    }
    if (day >= monthStart) {
      monthSeconds += seconds;
    }
  }
  
  const dailyAvg = daysWithData.length > 0 ? totalSeconds / daysWithData.length : 0;
  
  const monthsSet = new Set();
  for (const day of daysWithData) {
    monthsSet.add(day.substring(0, 7));
  }
  const monthlyAvg = monthsSet.size > 0 ? totalSeconds / monthsSet.size : 0;
  
  document.getElementById('today-stat').textContent = formatTime(todaySeconds);
  document.getElementById('week-stat').textContent = formatTime(weekSeconds);
  document.getElementById('month-stat').textContent = formatTime(monthSeconds);
  document.getElementById('total-stat').textContent = formatTime(totalSeconds);
  document.getElementById('daily-avg-stat').textContent = formatTime(dailyAvg);
  document.getElementById('monthly-avg-stat').textContent = formatTime(monthlyAvg);
}

let calHeatmap = null;

function buildHeatmap() {
  // Convert watchData to Cal-Heatmap format
  const heatmapData = [];

  for (const dateStr in watchData) {
    if (watchData[dateStr].totalSeconds > 0) {
      heatmapData.push({
        date: dateStr,
        value: watchData[dateStr].totalSeconds
      });
    }
  }
  
  // Find max for scaling
  let maxSeconds = 0;
  for (const entry of heatmapData) {
    if (entry.value > maxSeconds) maxSeconds = entry.value;
  }
  if (maxSeconds === 0) maxSeconds = 3600;
  
  // Calculate start date
  const today = new Date();
  const startDate = new Date(today.getFullYear(), today.getMonth() - 3, 1);
  
  // Destroy existing instance if any
  if (calHeatmap) {
    calHeatmap.destroy();
  }
  
  // Create new Cal-Heatmap instance
  calHeatmap = new CalHeatmap();
  
  calHeatmap.paint({
    animationDuration: 0,
	theme: darkModeEnabled ? 'dark' : 'light',
    data: {
      source: heatmapData,
      x: 'date',
      y: 'value'
    },
    date: {
      start: startDate,
      locale: 'en',
    },
    range: 7,
    domain: {
      type: 'month',
      gutter: 8,
      label: {
        text: 'MMM',
        position: 'bottom',
        textAlign: 'middle'
      }
    },
    subDomain: {
      type: 'day',
      width: 14,
      height: 14,
      gutter: 3,
      radius: 3
    },
    scale: {
	  color: {
		type: 'threshold',
		range: ['#fef3e2', '#fed7aa', '#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c'],
		domain: [1, maxSeconds * 0.15, maxSeconds * 0.3, maxSeconds * 0.5, maxSeconds * 0.7, maxSeconds * 0.9],
		emptyColor: darkModeEnabled ? '#292524' : '#EDEDED',
	  }
	},
    itemSelector: '#cal-heatmap'
  }, [
    [
      Tooltip,
      {
        text: function (date, value, dayjsDate) {
          const dateStr = dayjsDate.format('YYYY-MM-DD');
          const seconds = value || 0;
          const formatted = formatTime(seconds);
          return `${dayjsDate.format('MMM D, YYYY')}: ${formatted}`;
        }
      }
    ]
  ]);
}

function showTooltip(e) {
  const tooltip = document.getElementById('tooltip');
  const dateStr = e.target.dataset.date;
  const seconds = parseInt(e.target.dataset.seconds) || 0;
  
  const date = new Date(dateStr + 'T00:00:00');
  const formattedDate = date.toLocaleDateString('en-US', { 
    weekday: 'short', 
    month: 'short', 
    day: 'numeric',
    year: 'numeric'
  });
  
  tooltip.querySelector('.tooltip-date').textContent = formattedDate;
  tooltip.querySelector('.tooltip-value').textContent = seconds > 0 
    ? formatTimeVerbose(seconds) + ' watched'
    : 'No activity';
  
  tooltip.style.display = 'block';
  
  const rect = e.target.getBoundingClientRect();
  tooltip.style.left = `${rect.left + rect.width / 2 - tooltip.offsetWidth / 2}px`;
  tooltip.style.top = `${rect.top - tooltip.offsetHeight - 8}px`;
}

function hideTooltip() {
  document.getElementById('tooltip').style.display = 'none';
}

function buildWeeklyChart() {
  const container = document.getElementById('weekly-chart');
  container.innerHTML = '';
  
  const days = [];
  const today = new Date();
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    days.push({
      date: getDateString(date),
      label: date.toLocaleDateString('en-US', { weekday: 'short' }),
      isToday: i === 0
    });
  }
  
  const values = days.map(d => watchData[d.date]?.totalSeconds || 0);
  const maxValue = Math.max(...values, 60);
  
  for (let i = 0; i < days.length; i++) {
    const group = document.createElement('div');
    group.className = 'bar-group';
    
    const value = document.createElement('div');
    value.className = 'bar-value';
    value.textContent = values[i] > 0 ? formatTimeHours(values[i]) : '';
    
    const bar = document.createElement('div');
    bar.className = 'bar';
    const height = (values[i] / maxValue) * 120;
    bar.style.height = `${Math.max(height, 4)}px`;
    
    if (values[i] === 0) {
      bar.style.background = darkModeEnabled ? '#44403c' : '#fed7aa';
    }
    
    const label = document.createElement('div');
    label.className = 'bar-label';
    label.textContent = days[i].isToday ? 'Today' : days[i].label;
    
    group.appendChild(value);
    group.appendChild(bar);
    group.appendChild(label);
    container.appendChild(group);
  }
}

function buildMonthlyChart() {
  const container = document.getElementById('monthly-chart');
  container.innerHTML = '';
  
  const monthlyTotals = {};
  const today = new Date();
  
  for (let i = 5; i >= 0; i--) {
    const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    monthlyTotals[key] = {
      seconds: 0,
      label: date.toLocaleDateString('en-US', { month: 'short' })
    };
  }
  
  for (const day in watchData) {
    const monthKey = day.substring(0, 7);
    if (monthlyTotals[monthKey]) {
      monthlyTotals[monthKey].seconds += watchData[day].totalSeconds || 0;
    }
  }
  
  const months = Object.entries(monthlyTotals);
  const maxValue = Math.max(...months.map(m => m[1].seconds), 60);
  
  for (const [key, data] of months) {
    const row = document.createElement('div');
    row.className = 'monthly-row';
    
    const label = document.createElement('div');
    label.className = 'monthly-label';
    label.textContent = data.label;
    
    const barContainer = document.createElement('div');
    barContainer.className = 'monthly-bar-container';
    
    const bar = document.createElement('div');
    bar.className = 'monthly-bar';
    const width = (data.seconds / maxValue) * 100;
    bar.style.width = `${Math.max(width, 0)}%`;
    
    if (data.seconds > 0 && width > 15) {
      const valueSpan = document.createElement('span');
      valueSpan.className = 'monthly-value';
      valueSpan.textContent = formatTimeHours(data.seconds);
      bar.appendChild(valueSpan);
    }
    
    barContainer.appendChild(bar);
    
    row.appendChild(label);
    row.appendChild(barContainer);
    
    if (data.seconds > 0 && width <= 15) {
      const valueOutside = document.createElement('span');
      valueOutside.className = 'monthly-value outside';
      valueOutside.textContent = formatTimeHours(data.seconds);
      valueOutside.style.marginLeft = '8px';
      valueOutside.style.color = '#ea580c';
      valueOutside.style.fontSize = '11px';
      valueOutside.style.fontWeight = '600';
      row.appendChild(valueOutside);
    }
    
    container.appendChild(row);
  }
}

function init() {
  // Set up dark mode toggle
  document.getElementById('dark-mode-btn').addEventListener('click', () => {
    darkModeEnabled = !darkModeEnabled;
    if (isExtension) {
      browserAPI.storage.local.set({ darkModeEnabled });
    }
    updateDarkModeUI();
  });
  
  if (isExtension) {
    // Load initial data including dark mode setting
    browserAPI.storage.local.get(['watchData', 'darkModeEnabled'], (result) => {
      watchData = result.watchData || {};
      darkModeEnabled = result.darkModeEnabled === true;
      updateDarkModeUI();
      render();
    });
    
    // Listen for changes
    browserAPI.storage.onChanged.addListener((changes) => {
      if (changes.watchData) {
        watchData = changes.watchData.newValue || {};
        render();
      }
      if (changes.darkModeEnabled) {
        darkModeEnabled = changes.darkModeEnabled.newValue;
        updateDarkModeUI();
      }
    });
  } else {
    watchData = {};
    render();
  }
}

function render() {
  calculateStats();
  buildHeatmap();
  buildWeeklyChart();
  buildMonthlyChart();
}

init();