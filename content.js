const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

(function() {
  let video = null;
  let lastTime = 0;
  let totalWatchedSeconds = 0;
  let isTargetLanguage = false;
  let currentVideoId = null;
  let lastSaveTime = 0;
  let hasError = false;
  let detectionDone = false;
  let lastDetectedTitle = '';
  let pendingDetectionVideoId = null;
  let interceptedVideoData = {};
  let lastRealTime = 0;  // Add this at the top with other variables

  const TARGET_LANGUAGE = 'ja';

	// Inject fetch interceptor to capture caption data from YouTube's API
	function injectCaptionInterceptor() {
	  if (document.querySelector('script[data-mikan-interceptor]')) return;
	  
	  const script = document.createElement('script');
	  script.src = browserAPI.runtime.getURL('youtube-api-reader.js');
	  script.dataset.mikanInterceptor = 'true';
	  document.documentElement.appendChild(script);
	  console.log('Mikan: Caption interceptor injected via external script');
	}

	// Listen for video data from youtube-api-reader script
	window.addEventListener('message', (event) => {
	  if (event.data?.type === 'MIKAN_VIDEO_DATA') {
		console.log('Mikan: Received video data from interceptor:', event.data);
		interceptedVideoData[event.data.videoId] = {
		  title: event.data.title,
		  channelName: event.data.channelName,
		  captionLanguages: event.data.captionLanguages
		};
		
		// If we're waiting on detection for this video, trigger it now!
		if (pendingDetectionVideoId === event.data.videoId && !detectionDone) {
		  console.log('Mikan: Video data arrived for pending video, running detection now!');
		  runDetectionNow();
		}
	  }
	});

	// Inject the interceptor immediately
	injectCaptionInterceptor();

  function getVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    const watchId = urlParams.get('v');
    if (watchId) return watchId;
    
    const shortsMatch = window.location.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    if (shortsMatch) return shortsMatch[1];
    
    return null;
  }

  function isWatchPage() {
    return window.location.pathname.includes('/watch') || 
           window.location.pathname.includes('/shorts/');
  }

	function getCurrentTitle() {
	  const isShorts = window.location.pathname.includes('/shorts');
	  
	  if (isShorts) {
		const activeReel = document.querySelector('ytd-reel-video-renderer[is-active]');
		if (activeReel) {
		  const titleEl = activeReel.querySelector('h2.ytd-reel-player-header-renderer');
		  if (titleEl?.textContent?.trim()) {
			return titleEl.textContent.trim();
		  }
		}
	  }
	  
	  const titleElement = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string, h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string');
	  return titleElement?.textContent?.trim() || '';
	}

  function isTitleReady() {
    const title = document.title;
    if (title === 'YouTube' || title === '' || title === 'undefined') {
      return false;
    }
    return true;
  }

	function detectLanguage(videoId) {
	  console.log(`Mikan: === Detection Start for ${videoId} ===`);
	  
	  let title = '';
	  let channelName = '';
	  let captionLanguages = [];
	  let hasJapaneseCaptions = false;

	  // Use intercepted data as primary source
	  if (interceptedVideoData[videoId]) {
		const data = interceptedVideoData[videoId];
		title = data.title;
		channelName = data.channelName;
		captionLanguages = data.captionLanguages;
		hasJapaneseCaptions = captionLanguages.includes('ja');
		
		console.log(`Mikan: Using intercepted data`);
		console.log(`Mikan: Title: "${title}"`);
		console.log(`Mikan: Channel: "${channelName}"`);
		console.log(`Mikan: Captions: [${captionLanguages.join(', ')}]`);
	  } else {
		console.log(`Mikan: No intercepted data available, falling back to DOM`);
		const isShorts = window.location.pathname.includes('/shorts');
		
		if (isShorts) {
		  title = document.title.replace(' - YouTube', '').trim();
		  const activeReel = document.querySelector('ytd-reel-video-renderer[is-active]');
		  if (activeReel) {
			const channelEl = activeReel.querySelector('a.yt-core-attributed-string__link[href*="/@"]');
			channelName = channelEl?.textContent?.trim() || '';
		  }
		} else {
		  const titleElement = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
		  title = titleElement?.textContent?.trim() || document.title.replace(' - YouTube', '').trim();
		  const channelElement = document.querySelector('#channel-name yt-formatted-string a');
		  channelName = channelElement?.textContent?.trim() || '';
		}
		
		console.log(`Mikan: Title from DOM: "${title}"`);
		console.log(`Mikan: Channel from DOM: "${channelName}"`);
	  }

	  // Analyze Japanese content
	  const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF]/;
	  const hiraganaKatakana = (title.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || []).length;
	  const kanji = (title.match(/[\u4E00-\u9FAF]/g) || []).length;
	  const totalJapanese = hiraganaKatakana + kanji;
	  const titleLength = title.length;
	  
	  const hasKana = hiraganaKatakana > 0;
	  const japaneseRatio = titleLength > 0 ? totalJapanese / titleLength : 0;
	  const channelHasKana = japaneseRegex.test(channelName);

	  let isJapanese = false;
	  let reason = '';

	  // Japanese captions = definitely Japanese
	  if (hasJapaneseCaptions) {
		isJapanese = true;
		reason = `Japanese captions found [${captionLanguages.join(', ')}]`;
	  }
	  // No Japanese captions (or no captions at all) = use heuristics
	  else if (hasKana && japaneseRatio > 0.3) {
		isJapanese = true;
		reason = `Heuristics: Has kana + ${(japaneseRatio * 100).toFixed(0)}% Japanese chars (>30% threshold)`;
	  } else if (channelHasKana && japaneseRatio > 0.1) {
		isJapanese = true;
		reason = `Heuristics: Channel has kana + ${(japaneseRatio * 100).toFixed(0)}% Japanese chars (>10% threshold)`;
	  } else {
		isJapanese = false;
		reason = `Heuristics: ${(japaneseRatio * 100).toFixed(0)}% Japanese chars, hasKana=${hasKana}, channelHasKana=${channelHasKana}`;
	  }

	  console.log(`Mikan: --- Detection Summary ---`);
	  console.log(`Mikan: Title: "${title}"`);
	  console.log(`Mikan: Channel: "${channelName}"`);
	  console.log(`Mikan: Captions: ${captionLanguages.length > 0 ? `[${captionLanguages.join(', ')}]` : 'none found'}`);
	  console.log(`Mikan: Japanese chars: ${totalJapanese}/${titleLength} (${(japaneseRatio * 100).toFixed(0)}%) - Kana: ${hiraganaKatakana}, Kanji: ${kanji}`);
	  console.log(`Mikan: Result: ${isJapanese ? 'JAPANESE' : 'NOT JAPANESE'}`);
	  console.log(`Mikan: Reason: ${reason}`);
	  console.log(`Mikan: === Detection End ===`);
	  
	  return isJapanese;
	}

  function isAdPlaying() {
    return !!(
      document.querySelector('.ad-showing') ||
      document.querySelector('.ytp-ad-player-overlay') ||
      document.querySelector('.ytp-ad-text')
    );
  }

  function getLocalDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function saveProgress() {
    if (totalWatchedSeconds < 1) return;
    
    if (!browserAPI.runtime?.id) {
      console.log('Mikan: Extension context invalidated, skipping save');
      return;
    }

    const today = getLocalDateString();

    browserAPI.storage.local.get(['watchData'], (result) => {
      if (browserAPI.runtime.lastError) {
        console.log('Mikan: Storage error:', browserAPI.runtime.lastError);
        return;
      }
      
      const watchData = result.watchData || {};
    
      if (!watchData[today]) {
        watchData[today] = { totalSeconds: 0, videos: {} };
      }
    
      if (!watchData[today].videos[currentVideoId]) {
        watchData[today].videos[currentVideoId] = 0;
      }
    
      const previouslyStored = watchData[today].videos[currentVideoId];
      watchData[today].videos[currentVideoId] = previouslyStored + totalWatchedSeconds;
    
      totalWatchedSeconds = 0;
      lastTime = video ? video.currentTime : 0;
    
      watchData[today].totalSeconds = Object.values(watchData[today].videos)
        .reduce((sum, secs) => sum + secs, 0);
    
      browserAPI.storage.local.set({ watchData });
    });
  }

  function shouldTrack() {
    return isTargetLanguage;
  }

  function handleTimeUpdate() {
    if (!video) return;
    if (!shouldTrack()) return;
    if (video.paused) return;
    if (isAdPlaying()) return;

    const now = Date.now();
    
    if (lastRealTime > 0) {
      const realDelta = (now - lastRealTime) / 1000;  // Convert ms to seconds
      
      if (realDelta > 0 && realDelta < 2) {
        totalWatchedSeconds += realDelta;
      }
    }
    
    lastRealTime = now;
    lastTime = video.currentTime;  // Keep this for seek detection
    
    if (now - lastSaveTime >= 1000) {
      saveProgress();
      lastSaveTime = now;
    }
  }

  function startTrackingIfPlaying() {
    if (video && !video.paused && shouldTrack()) {
      lastTime = video.currentTime;
      lastSaveTime = Date.now();
      console.log('Mikan: Video already playing, starting to track');
    }
  }

  // Split detection into two functions
	function runDetectionNow() {
	  const videoId = getVideoId();
	  if (!videoId || detectionDone) return;
	  
	  detectionDone = true;
	  pendingDetectionVideoId = null;
	  lastDetectedTitle = getCurrentTitle();
	  
	  isTargetLanguage = detectLanguage(videoId);
	  hasError = false;
	  
	  updateIconState();
	  startTrackingIfPlaying();
	}

	function runDetection(retryCount = 0) {
	  if (detectionDone) return;
	  
	  const videoId = getVideoId();
	  if (!videoId) return;
	  
	  pendingDetectionVideoId = videoId;
	  
	  // Check if we already have intercepted data for THIS video
	  if (interceptedVideoData[videoId]) {
		console.log('Mikan: Have intercepted data for current video, detecting immediately');
		runDetectionNow();
		return;
	  }
	  
	  // No data yet - retry up to 3 seconds
	  // (The message listener will also call runDetectionNow() if data arrives mid-wait)
	  const maxRetries = 20;
	  const retryDelay = 150;
	  
	  if (retryCount < maxRetries) {
		setTimeout(() => runDetection(retryCount + 1), retryDelay);
	  } else {
		// Timeout - proceed with DOM fallback
		console.log('Mikan: Detection timeout, proceeding with DOM fallback');
		runDetectionNow();
	  }
	}

  function updateIconState() {
    browserAPI.runtime.sendMessage({ 
      type: 'updateIcon', 
      state: isTargetLanguage ? 'active' : 'inactive' 
    });
  }

  function handlePlay() {
    if (!video) return;
      lastTime = video.currentTime;
      lastRealTime = Date.now();  // Add this
      lastSaveTime = Date.now();
    
    if (!detectionDone) {
      runDetection();
    }
    
    console.log('Mikan: Video playing, tracking:', shouldTrack());
  }

  function handlePause() {
    saveProgress();
    lastRealTime = 0;  // Add this - reset so we don't count paused time
    console.log('Mikan: Video paused, progress saved');
  }

  function handleSeeked() {
    lastTime = video.currentTime;
    lastRealTime = Date.now();  // Add this - reset after seeking
  }

  function resetForNewVideo(newVideoId) {
    if (currentVideoId && totalWatchedSeconds > 0) {
      saveProgress();
    }
    
    console.log(`Mikan: New video detected: ${newVideoId}`);
    
    currentVideoId = newVideoId;
    totalWatchedSeconds = 0;
    lastTime = 0;
    lastSaveTime = 0;
    detectionDone = false;
    isTargetLanguage = false;
    lastRealTime = 0;
  }

  function findActiveVideo() {
    const isShorts = window.location.pathname.includes('/shorts');
    
    if (isShorts) {
      const activeReel = document.querySelector('ytd-reel-video-renderer[is-active]');
      if (activeReel) {
        const videoEl = activeReel.querySelector('video');
        if (videoEl) {
          console.log('Mikan: Found video in active reel');
          return videoEl;
        }
      }
      const videos = document.querySelectorAll('video');
      for (const v of videos) {
        if (!v.paused && v.src) {
          console.log('Mikan: Found playing video as fallback');
          return v;
        }
      }
    }
    
    return document.querySelector('video');
  }

  function attachVideoListeners(videoElement) {
    if (!videoElement) return;
    
    if (video && video !== videoElement) {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('seeked', handleSeeked);
      console.log('Mikan: Removed listeners from old video element');
    }
    
    video = videoElement;
    
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('seeked', handleSeeked);
    
    console.log('Mikan: Attached listeners to video, paused:', video.paused, 'currentTime:', video.currentTime);
  }

  function initializeTracker() {
    if (!isWatchPage()) {
      console.log('Mikan: Not a watch page, skipping');
      return;
    }
    
    const newVideoId = getVideoId();
    if (!newVideoId) {
      console.log('Mikan: No video ID found');
      return;
    }

    if (newVideoId !== currentVideoId) {
      resetForNewVideo(newVideoId);
    }

    const videoElement = findActiveVideo();
    
    if (videoElement) {
      attachVideoListeners(videoElement);
      lastTime = video.currentTime;
      
      // Always try to run detection for new videos
      if (!detectionDone) {
        runDetection();
      }
      
      console.log('Mikan: Tracker initialized');
    } else {
      console.log('Mikan: No video element found, will retry');
      setTimeout(initializeTracker, 200);
    }
  }

  function setupShortsObserver() {
    const observer = new MutationObserver((mutations) => {
      if (!window.location.pathname.includes('/shorts')) return;
      
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'is-active') {
          const target = mutation.target;
          if (target.hasAttribute('is-active')) {
            console.log('Mikan: Active reel changed');
            setTimeout(() => {
              const newVideo = target.querySelector('video');
              if (newVideo && newVideo !== video) {
                console.log('Mikan: New video element in active reel');
                attachVideoListeners(newVideo);
                lastTime = video.currentTime;
                if (!video.paused && detectionDone && shouldTrack()) {
                  lastSaveTime = Date.now();
                }
              }
            }, 100);
          }
        }
      }
    });
    
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['is-active'],
      subtree: true
    });
    
    console.log('Mikan: Shorts observer set up');
  }

	function init() {
	  initializeTracker();
	  setupShortsObserver();
	}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('yt-navigate-finish', () => {
    console.log('Mikan: Navigation detected');
    setTimeout(initializeTracker, 100);
  });

  window.addEventListener('popstate', () => {
    console.log('Mikan: Popstate detected');
    setTimeout(initializeTracker, 100);
  });

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      console.log('Mikan: URL change detected via polling');
      setTimeout(initializeTracker, 100);
    }
  }, 500);

  window.addEventListener('beforeunload', saveProgress);

  browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'getStatus') {
      sendResponse({
        isTargetLanguage,
        currentVideoId,
        hasError
      });
	} else if (message.type === 'toggleForce') {
	  isTargetLanguage = !isTargetLanguage;
	  hasError = false;
	  updateIconState();
	  startTrackingIfPlaying();
	  sendResponse({ success: true, isTargetLanguage });
	}
    return true;
  });
})();