"use strict";

const DEFAULT_POSITION = [49.2181083, 16.6494211];

const map = L.map("map", {
  zoomControl: false,
  fadeAnimation: false,
  zoomAnimation: false,
  markerZoomAnimation: false
}).setView(DEFAULT_POSITION, 16);

L.control.zoom({ position: "topleft" }).addTo(map);

const streetLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  updateWhenZooming: false,
  updateWhenIdle: true,
  keepBuffer: 1,
  attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a> (ODbL)'
}).addTo(map);

const railwayLayer = L.tileLayer("https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png", {
  maxZoom: 19,
  updateWhenZooming: false,
  updateWhenIdle: true,
  keepBuffer: 1,
  opacity: 0.8,
  attribution: "&copy; OpenRailwayMap"
}).addTo(map);

L.control.layers(
  { "Základní mapa": streetLayer },
  { "Železniční infrastruktura": railwayLayer },
  { position: "bottomright" }
).addTo(map);

const appState = {
  latestPosition: null,
  matchedPosition: null,
  following: true,
  networkBytes: 0,
  networkRequests: 0
};

const measuredNetworkEntries = new Set();

function registerNetworkEntry(entry) {
  const entryKey = `${entry.name}|${Math.round(entry.startTime)}|${Math.round(entry.duration)}`;
  if (measuredNetworkEntries.has(entryKey)) return;
  measuredNetworkEntries.add(entryKey);
  const bytes = Number(entry.transferSize || entry.encodedBodySize || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return;
  appState.networkBytes += bytes;
  appState.networkRequests += 1;
  window.dispatchEvent(new CustomEvent("railnavigator:network", {
    detail: { bytes: appState.networkBytes, requests: appState.networkRequests }
  }));
}

try {
  performance.getEntriesByType("resource").forEach(registerNetworkEntry);
  const networkObserver = new PerformanceObserver((list) => list.getEntries().forEach(registerNetworkEntry));
  networkObserver.observe({ type: "resource", buffered: true });
} catch (error) {
  console.info("Měření přenesených dat není v tomto prohlížeči úplné.", error);
}

const followButton = document.getElementById("follow-button");
const notice = document.getElementById("notice");
let noticeTimer = null;

function showNotice(message) {
  notice.textContent = message;
  notice.classList.add("visible");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.remove("visible"), 2800);
}

function setFollowing(enabled) {
  appState.following = enabled;
  followButton.classList.toggle("active", enabled);
  followButton.textContent = enabled ? "◎ Sledovat" : "◎ Návrat";
}

map.on("dragstart", () => setFollowing(false));

followButton.addEventListener("click", () => {
  setFollowing(true);
  const target = appState.matchedPosition || appState.latestPosition || DEFAULT_POSITION;
  map.setView(target, appState.latestPosition ? 17 : 16);
});

let wakeLock = null;
let keepScreenAwake = false;
const wakeButton = document.getElementById("wake-button");

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) {
    showNotice("Tento prohlížeč nezhasínání displeje nepodporuje.");
    return;
  }

  try {
    keepScreenAwake = true;
    wakeLock = await navigator.wakeLock.request("screen");
    wakeButton.classList.add("active");
    wakeButton.textContent = "☀ Zapnuto";
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
      wakeButton.classList.remove("active");
      wakeButton.textContent = "☀ Displej";
    });
    showNotice("Displej zůstane během jízdy zapnutý.");
  } catch (error) {
    showNotice("Nezhasínání displeje se nepodařilo zapnout.");
    console.warn("Wake Lock chyba:", error);
  }
}

wakeButton.addEventListener("click", async () => {
  if (keepScreenAwake) {
    keepScreenAwake = false;
    if (wakeLock) await wakeLock.release();
    showNotice("Automatické nezhasínání displeje je vypnuté.");
  } else {
    requestWakeLock();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && keepScreenAwake && !wakeLock) {
    requestWakeLock();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Service worker se nepodařilo zaregistrovat:", error);
    });
  });
}
