"use strict";

const DEFAULT_POSITION = [49.2181083, 16.6494211];

const map = L.map("map", {
  zoomControl: false
}).setView(DEFAULT_POSITION, 16);

L.control.zoom({ position: "topleft" }).addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

let latestPosition = null;

document.getElementById("north-button").addEventListener("click", () => {
  if (latestPosition) {
    map.setView(latestPosition, Math.max(map.getZoom(), 17));
  } else {
    map.setView(DEFAULT_POSITION, 16);
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Service worker se nepodařilo zaregistrovat:", error);
    });
  });
}

