const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

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

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getWeekStart() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const weekStart = new Date(now.getFullYear(), now.getMonth(), diff);
  return getLocalDateString(weekStart);
}

function getMonthStart() {
  const now = new Date();
  return getLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1));
}

let currentTabId = null;
let darkModeEnabled = false;

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
}

function updateStats() {
  browserAPI.storage.local.get(['watchData'], (result) => {
    const watchData = result.watchData || {};
    const today = getLocalDateString();
    const weekStart = getWeekStart();
    const monthStart = getMonthStart();

    let todaySeconds = 0;
    let weekSeconds = 0;
    let monthSeconds = 0;
    let totalSeconds = 0;

    const sortedDays = Object.keys(watchData).sort().reverse();

    for (const day of sortedDays) {
      const dayData = watchData[day];
      const seconds = dayData.totalSeconds || 0;

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

    document.getElementById('today-time').textContent = formatTime(todaySeconds);
    document.getElementById('week-time').textContent = formatTime(weekSeconds);
    document.getElementById('month-time').textContent = formatTime(monthSeconds);

    browserAPI.storage.local.set({ cachedTotalSeconds: totalSeconds });
  });
}

function getSupportedVideoPage(tabUrl) {
  const isYouTube =
    tabUrl.includes('youtube.com/watch') ||
    tabUrl.includes('youtube.com/shorts/');

  const isNetflix =
    tabUrl.includes('netflix.com/watch/');

  if (isYouTube) return 'youtube';
  if (isNetflix) return 'netflix';

  return null;
}

function updateStatus() {
  browserAPI.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    const statusCard = document.getElementById('status-card');
    const statusText = document.getElementById('status-text');
    const statusSubtext = document.getElementById('status-subtext');
    const forceBtn = document.getElementById('force-btn');

    if (!tab || !tab.url) {
      statusCard.className = 'card status-card inactive';
      statusText.textContent = 'No tab detected';
      statusSubtext.textContent = '';
      forceBtn.style.display = 'none';
      currentTabId = null;
      return;
    }

    const platform = getSupportedVideoPage(tab.url);

    if (!platform) {
      statusCard.className = 'card status-card inactive';
      statusText.textContent = 'Not on a supported video page';
      statusSubtext.textContent = 'Open a YouTube or Netflix video to track';
      forceBtn.style.display = 'none';
      currentTabId = null;
      return;
    }

    currentTabId = tab.id;

    browserAPI.tabs.sendMessage(tab.id, { type: 'getStatus' }, (response) => {
      console.log('Mikan popup received:', response);

      if (browserAPI.runtime.lastError || !response) {
        statusCard.className = 'card status-card inactive';
        statusText.textContent = 'Extension not loaded';
        statusSubtext.textContent = 'Try refreshing the page';
        forceBtn.style.display = 'none';

        browserAPI.runtime.sendMessage({
          type: 'updateIcon',
          state: 'error',
          tabId: tab.id
        });

        return;
      }

      forceBtn.style.display = 'block';

      if (response.isTargetLanguage) {
        forceBtn.textContent = 'Mark as Non-Japanese';
      } else {
        forceBtn.textContent = 'Mark as Japanese';
      }

      if (response.hasError) {
        statusCard.className = 'card status-card wrong-lang';
        statusText.textContent = '⚠️ Auto detection failed';
        statusSubtext.textContent = 'Use button to manually override';
      } else if (response.isTargetLanguage) {
        statusCard.className = 'card status-card active';

        if (platform === 'netflix') {
          statusText.textContent = '🎌 Tracking Japanese Netflix';
        } else {
          statusText.textContent = '🎌 Tracking Japanese YouTube';
        }

        statusSubtext.textContent = '';
      } else {
        statusCard.className = 'card status-card wrong-lang';
        statusText.textContent = '⏸️ Not marked as Japanese';

        if (platform === 'netflix') {
          statusSubtext.textContent = 'Use button below if this Netflix video is Japanese';
        } else {
          statusSubtext.textContent = 'Use button below to override';
        }
      }
    });
  });
}

document.getElementById('force-btn').addEventListener('click', () => {
  if (currentTabId) {
    browserAPI.tabs.sendMessage(currentTabId, { type: 'toggleForce' }, (response) => {
      if (response) {
        updateStatus();
      }
    });
  }
});

document.getElementById('dashboard-btn').addEventListener('click', () => {
  browserAPI.tabs.create({ url: browserAPI.runtime.getURL('dashboard.html') });
});

document.getElementById('dark-mode-btn').addEventListener('click', () => {
  darkModeEnabled = !darkModeEnabled;
  browserAPI.storage.local.set({ darkModeEnabled });
  updateDarkModeUI();
});

browserAPI.storage.onChanged.addListener((changes) => {
  if (changes.darkModeEnabled) {
    darkModeEnabled = changes.darkModeEnabled.newValue;
    updateDarkModeUI();
  }
});

browserAPI.storage.local.get(['darkModeEnabled'], (result) => {
  darkModeEnabled = result.darkModeEnabled === true;
  updateDarkModeUI();
  updateStats();
  updateStatus();
});

setInterval(() => {
  updateStats();
  updateStatus();
}, 1000);