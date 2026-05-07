const browserAPI = typeof browser !== "undefined" ? browser : chrome;

(function () {
  let video = null;
  let currentVideoId = null;
  let totalWatchedSeconds = 0;
  let lastRealTime = 0;
  let lastSaveTime = 0;
  let isTargetLanguage = true;
  let hasError = false;
  let trackerInterval = null;
  let contextInvalidated = false;

  function getNetflixVideoId() {
    const match = window.location.pathname.match(/\/watch\/(\d+)/);
    return match ? `netflix-${match[1]}` : null;
  }

  function isExtensionContextValid() {
    if (contextInvalidated) return false;

    try {
      return Boolean(browserAPI?.runtime?.id);
    } catch (error) {
      contextInvalidated = true;
      return false;
    }
  }

  function stopTracker() {
    contextInvalidated = true;
    if (trackerInterval) {
      clearInterval(trackerInterval);
      trackerInterval = null;
    }
  }

  function isWatchPage() {
    return window.location.pathname.includes("/watch/");
  }

  function getLocalDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function getNetflixOverrides() {
    try {
      return JSON.parse(localStorage.getItem("mikanNetflixOverrides") || "{}");
    } catch (error) {
      return {};
    }
  }

  function setNetflixOverride(videoId, shouldTrack) {
    const overrides = getNetflixOverrides();
    overrides[videoId] = shouldTrack;
    localStorage.setItem("mikanNetflixOverrides", JSON.stringify(overrides));
  }

  function updateTrackingPreference() {
    const overrides = getNetflixOverrides();
    isTargetLanguage = currentVideoId && Object.prototype.hasOwnProperty.call(overrides, currentVideoId)
      ? overrides[currentVideoId] === true
      : true;
    hasError = false;
    updateIconState();
  }

  function saveProgress() {
    if (totalWatchedSeconds < 1 || !currentVideoId) return;
    if (!isExtensionContextValid()) {
      stopTracker();
      return;
    }

    const today = getLocalDateString();

    try {
      browserAPI.storage.local.get(["watchData"], (result) => {
        if (!isExtensionContextValid()) return;

        const watchData = result.watchData || {};

        if (!watchData[today]) {
          watchData[today] = { totalSeconds: 0, videos: {} };
        }

        if (!watchData[today].videos[currentVideoId]) {
          watchData[today].videos[currentVideoId] = 0;
        }

        watchData[today].videos[currentVideoId] += totalWatchedSeconds;
        totalWatchedSeconds = 0;

        watchData[today].totalSeconds = Object.values(watchData[today].videos)
          .reduce((sum, secs) => sum + secs, 0);

        if (!isExtensionContextValid()) return;

        try {
          browserAPI.storage.local.set({ watchData });
        } catch (error) {
          stopTracker();
        }
      });
    } catch (error) {
      stopTracker();
    }
  }

  function updateIconState() {
    if (!isExtensionContextValid()) {
      stopTracker();
      return;
    }

    try {
      browserAPI.runtime.sendMessage({
        type: "updateIcon",
        state: isTargetLanguage ? "active" : "inactive"
      });
    } catch (error) {
      stopTracker();
    }
  }

  function handleTimeUpdate() {
    if (!video || video.paused || !isTargetLanguage) return;

    const now = Date.now();

    if (lastRealTime > 0) {
      const delta = (now - lastRealTime) / 1000;
      if (delta > 0 && delta < 2) {
        totalWatchedSeconds += delta;
      }
    }

    lastRealTime = now;

    if (now - lastSaveTime >= 1000) {
      saveProgress();
      lastSaveTime = now;
    }
  }

  function attachVideoListeners(videoElement) {
    if (!videoElement || video === videoElement) return;

    if (video) {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("seeked", handleSeeked);
    }

    video = videoElement;

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("pause", handlePause);
    video.addEventListener("play", handlePlay);
    video.addEventListener("seeked", handleSeeked);
  }

  function handlePlay() {
    lastRealTime = Date.now();
    lastSaveTime = Date.now();
    updateTrackingPreference();
  }

  function handlePause() {
    saveProgress();
    lastRealTime = 0;
  }

  function handleSeeked() {
    lastRealTime = Date.now();
  }

  function initialiseTracker() {
    if (!isExtensionContextValid()) {
      stopTracker();
      return;
    }

    if (!isWatchPage()) return;

    const newVideoId = getNetflixVideoId();
    if (!newVideoId) return;

    if (newVideoId !== currentVideoId) {
      saveProgress();
      currentVideoId = newVideoId;
      totalWatchedSeconds = 0;
      lastRealTime = 0;
      updateTrackingPreference();
    }

    const videoElement = document.querySelector("video");
    if (videoElement) {
      attachVideoListeners(videoElement);
    }
  }

  trackerInterval = setInterval(() => {
    try {
      initialiseTracker();
    } catch (error) {
      if (String(error?.message || error).includes("Extension context invalidated")) {
        stopTracker();
        return;
      }

      throw error;
    }
  }, 1000);
  window.addEventListener("beforeunload", saveProgress);

  try {
    browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === "getStatus") {
        sendResponse({
          isTargetLanguage,
          currentVideoId,
          hasError
        });
      }

      if (message.type === "toggleForce") {
        isTargetLanguage = !isTargetLanguage;
        if (currentVideoId) {
          setNetflixOverride(currentVideoId, isTargetLanguage);
        }
        hasError = false;
        updateIconState();

        if (video && !video.paused && isTargetLanguage) {
          lastRealTime = Date.now();
        }

        sendResponse({
          success: true,
          isTargetLanguage
        });
      }

      return true;
    });
  } catch (error) {
    stopTracker();
  }
})();
