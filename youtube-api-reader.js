// injected.js - intercept YouTube player requests

// This script is bundled locally with the extension.
// It is injected into the page context to intercept YouTube API responses.
// No remote code is fetched or executed.

(function() {
  console.log('Mikan: Interceptor script running in page context');
  
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = args[0]?.url || args[0];
    
    // Log all YouTube API requests to see what Shorts uses
    if (typeof url === 'string' && url.includes('youtube.com/youtubei/')) {
      console.log('Mikan: YouTube API request:', url.split('?')[0]);
    }
    
    // Intercept player requests
    if (typeof url === 'string' && url.includes('/youtubei/v1/player')) {
      console.log('Mikan: Intercepted player request!');
      try {
        const response = await originalFetch.apply(this, args);
        const clone = response.clone();
        
        clone.json().then(data => {
          if (data?.videoDetails?.videoId) {
            const videoDetails = data.videoDetails;
            const videoId = videoDetails.videoId;
            const title = videoDetails.title || '';
            const channelName = videoDetails.author || '';
            
            const captions = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
            const languages = captions.map(t => t.languageCode);
            
            console.log(`Mikan: Posting video data for: ${videoId}`);
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
        }).catch(e => console.log('Mikan: Error parsing player response:', e));
        
        return response;
      } catch (e) {
        return originalFetch.apply(this, args);
      }
    }
    
    // Also intercept reel requests (Shorts use this)
    if (typeof url === 'string' && url.includes('/youtubei/v1/reel')) {
      console.log('Mikan: Intercepted reel request!');
      try {
        const response = await originalFetch.apply(this, args);
        const clone = response.clone();
        
        clone.json().then(data => {
          console.log('Mikan: Reel response:', JSON.stringify(data, null, 2).substring(0, 2000));
        }).catch(e => console.log('Mikan: Error parsing reel response:', e));
        
        return response;
      } catch (e) {
        return originalFetch.apply(this, args);
      }
    }
    
    return originalFetch.apply(this, args);
  };
  
  console.log('Mikan: Fetch interceptor installed');
})();