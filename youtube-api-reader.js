// youtube-api-reader.js - intercept YouTube player requests

(function() {
  console.log('Mikan: Interceptor script running in page context');
  
  let postedVideoIds = new Set();
  
  function processPlayerData(data, source) {
    if (!data?.videoDetails?.videoId) {
      console.log(`Mikan: No videoDetails in response from ${source}`);
      return;
    }
    
    const videoDetails = data.videoDetails;
    const videoId = videoDetails.videoId;
    const title = videoDetails.title || '';
    const channelName = videoDetails.author || '';
    
    const urlMatch = window.location.href.match(/[?&]v=([^&]+)/) || 
                     window.location.pathname.match(/\/shorts\/([^/?]+)/);
    const urlVideoId = urlMatch?.[1];
    
    if (videoId !== urlVideoId) {
      console.log(`Mikan: Skipping mismatched video data. Got ${videoId}, URL has ${urlVideoId}`);
      return;
    }
    
    if (postedVideoIds.has(videoId)) {
      console.log(`Mikan: Already posted data for ${videoId}`);
      return;
    }
    postedVideoIds.add(videoId);
    
    const captions = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const languages = captions.map(t => t.languageCode);
    
    console.log(`Mikan: Posting video data for: ${videoId} (source: ${source})`);
    console.log(`Mikan: Title: "${title}"`);
    console.log(`Mikan: Channel: "${channelName}"`);
    console.log(`Mikan: Captions: [${languages.join(', ')}]`);
    
    window.postMessage({
      type: 'MIKAN_VIDEO_DATA',
      videoId: videoId,
      title: title,
      channelName: channelName,
      captionLanguages: languages
    }, '*');
  }
  
  function getDataFromPlayerApi() {
    const player = document.getElementById('movie_player');
    if (!player || typeof player.getVideoData !== 'function') {
      return null;
    }
    
    const videoData = player.getVideoData();
    if (!videoData?.video_id) {
      return null;
    }
    
    // Get caption tracks from player
    let captionLanguages = [];
    
    // Method 1: Try getOption for captions
    if (typeof player.getOption === 'function') {
      try {
        const captionTracklist = player.getOption('captions', 'tracklist');
        if (Array.isArray(captionTracklist)) {
          captionLanguages = captionTracklist.map(t => t.languageCode).filter(Boolean);
        }
      } catch (e) {}
    }
    
    // Method 2: Try to find caption data in player's internal state
    if (captionLanguages.length === 0 && player.getPlayerResponse) {
      try {
        const response = player.getPlayerResponse();
        const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (Array.isArray(tracks)) {
          captionLanguages = tracks.map(t => t.languageCode).filter(Boolean);
        }
      } catch (e) {}
    }
    
    return {
      videoId: videoData.video_id,
      title: videoData.title || '',
      channelName: videoData.author || '',
      captionLanguages: captionLanguages
    };
  }

  function pollForPlayerApi() {
    const urlParams = new URLSearchParams(window.location.search);
    const expectedVideoId = urlParams.get('v') || 
      window.location.pathname.match(/\/shorts\/([^/?]+)/)?.[1];
    
    if (!expectedVideoId) return;
    
    let attempts = 0;
    const maxAttempts = 30;
    const interval = 200;
    
    const check = () => {
      attempts++;
      
      const data = getDataFromPlayerApi();
      
      if (data && data.videoId === expectedVideoId) {
        if (postedVideoIds.has(expectedVideoId)) {
          return;
        }
        
        console.log(`Mikan: Got data from player API on attempt ${attempts}`);
        console.log(`Mikan: Title: "${data.title}"`);
        console.log(`Mikan: Channel: "${data.channelName}"`);
        console.log(`Mikan: Captions: [${data.captionLanguages.join(', ')}]`);
        
        postedVideoIds.add(expectedVideoId);
        
        window.postMessage({
          type: 'MIKAN_VIDEO_DATA',
          videoId: data.videoId,
          title: data.title,
          channelName: data.channelName,
          captionLanguages: data.captionLanguages
        }, '*');
        return;
      }
      
      if (attempts < maxAttempts) {
        setTimeout(check, interval);
      } else {
        console.log(`Mikan: Player API polling timed out for ${expectedVideoId}`);
      }
    };
    
    check();
  }
  
  function pollForInitialResponse() {
    let attempts = 0;
    const maxAttempts = 20;
    const interval = 250;
    
    const urlParams = new URLSearchParams(window.location.search);
    const expectedVideoId = urlParams.get('v') || 
      window.location.pathname.match(/\/shorts\/([^/?]+)/)?.[1];
    
    const check = () => {
      attempts++;
      
      // Re-check current URL in case it changed during polling
      const currentParams = new URLSearchParams(window.location.search);
      const currentVideoId = currentParams.get('v') || 
        window.location.pathname.match(/\/shorts\/([^/?]+)/)?.[1];
      
      if (currentVideoId !== expectedVideoId) {
        console.log('Mikan: URL changed during polling, aborting');
        return;
      }
      
      if (window.ytInitialPlayerResponse?.videoDetails?.videoId) {
        const foundId = window.ytInitialPlayerResponse.videoDetails.videoId;
        
        if (foundId === expectedVideoId) {
          console.log(`Mikan: Found matching ytInitialPlayerResponse on attempt ${attempts}`);
          processPlayerData(window.ytInitialPlayerResponse, 'ytInitialPlayerResponse');
          return;
        } else {
          console.log(`Mikan: ytInitialPlayerResponse has ${foundId}, waiting for ${expectedVideoId} (attempt ${attempts})`);
        }
      }
      
      if (attempts < maxAttempts) {
        setTimeout(check, interval);
      } else {
        console.log(`Mikan: ytInitialPlayerResponse polling timed out waiting for ${expectedVideoId}`);
      }
    };
    
    check();
  }
  
  pollForInitialResponse();
  
  let lastUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      console.log(`Mikan: URL changed from ${lastUrl} to ${window.location.href}`);
      lastUrl = window.location.href;
      postedVideoIds.clear();
      
      // For SPA navigation, player API is more reliable
      pollForPlayerApi();
    }
  }, 500);
  
  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = args[0]?.url || args[0];
    
    if (typeof url === 'string' && url.includes('/youtubei/v1/player')) {
      console.log('Mikan: Intercepted player fetch request');
      
      try {
        const response = await originalFetch.apply(this, args);
        const clone = response.clone();
        
        clone.json().then(data => {
          processPlayerData(data, 'fetch');
        }).catch(e => console.log('Mikan: Error parsing fetch response:', e));

        return response;
      } catch (e) {
        return originalFetch.apply(this, args);
      }
    }
    
    return originalFetch.apply(this, args);
  };
  
  console.log('Mikan: Fetch interceptor installed');
  
  // Intercept XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._mikanUrl = url;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };
  
  XMLHttpRequest.prototype.send = function(body) {
    if (this._mikanUrl && this._mikanUrl.includes('/youtubei/v1/player')) {
      console.log('Mikan: Intercepted player XHR request');
      
      this.addEventListener('load', function() {
        try {
          const data = JSON.parse(this.responseText);
          processPlayerData(data, 'xhr');
        } catch (e) {
          console.log('Mikan: Error parsing XHR response:', e);
        }
      });
    }
    
    return originalXHRSend.apply(this, [body]);
  };
  
  console.log('Mikan: XHR interceptor installed');
  
  // Also try to hook into YouTube's internal player API
  // YouTube stores player data in various places
  const checkForPlayerApi = () => {
    // Try to find the movie_player element and its data
    const player = document.getElementById('movie_player');
    if (player && typeof player.getVideoData === 'function') {
      const videoData = player.getVideoData();
      if (videoData && videoData.video_id) {
        console.log('Mikan: Found player API, video:', videoData.video_id);
        
        // The player API doesn't have captions, but we can note we found it
        // We'd need to get captions another way
      }
    }
  };
  
  // Check periodically for player API
  setInterval(checkForPlayerApi, 2000);
})();