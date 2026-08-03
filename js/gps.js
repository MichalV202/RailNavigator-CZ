"use strict";

const speedValue = document.getElementById("speed-value");
const gpsStatus = document.getElementById("gps-status");
const headingValue = document.getElementById("heading");
const recordButton = document.getElementById("record-button");
const exportButton = document.getElementById("export-button");
const summaryButton = document.getElementById("summary-button");
const testPanel = document.getElementById("test-panel");
const closeSummaryButton = document.getElementById("close-summary-button");
const SESSION_STORAGE_KEY = "railnavigator-session-v2";

const trainIcon = L.divIcon({
  className: "train-icon",
  html: '<span class="train-marker-content"><span class="train-arrow">▲</span><span>🚆</span></span>',
  iconSize: [42, 42],
  iconAnchor: [21, 21]
});

let trainMarker = null;
let firstGpsFix = true;
let lastPoint = null;
let recording = false;
let samples = [];
let gpsHistory = [];
let lastRecordedPoint = null;
let lastMatchedWayId = null;
let statsTimer = null;
let stats = createEmptyStats();
const trailLine = L.polyline([], {
  color: "#ffcc00",
  weight: 4,
  opacity: 0.9,
  interactive: false
}).addTo(map);

function createEmptyStats() {
  return {
    startedAt: null,
    stoppedAt: null,
    distanceMetres: 0,
    speedSum: 0,
    speedSamples: 0,
    maxSpeed: 0,
    accuracySum: 0,
    accuracySamples: 0,
    trackChanges: 0
  };
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor(totalSeconds % 3600 / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function updateStatsPanel() {
  const endTime = recording ? Date.now() : (stats.stoppedAt || Date.now());
  const duration = stats.startedAt ? endTime - stats.startedAt : 0;
  const averageSpeed = stats.speedSamples ? stats.speedSum / stats.speedSamples : 0;
  const averageAccuracy = stats.accuracySamples ? stats.accuracySum / stats.accuracySamples : null;
  document.getElementById("stat-duration").textContent = formatDuration(duration);
  document.getElementById("stat-distance").textContent = `${(stats.distanceMetres / 1000).toFixed(2)} km`;
  document.getElementById("stat-average-speed").textContent = `${Math.round(averageSpeed)} km/h`;
  document.getElementById("stat-max-speed").textContent = `${Math.round(stats.maxSpeed)} km/h`;
  document.getElementById("stat-average-accuracy").textContent = averageAccuracy === null ? "-- m" : `${Math.round(averageAccuracy)} m`;
  document.getElementById("stat-samples").textContent = String(samples.length);
  document.getElementById("stat-track-changes").textContent = String(stats.trackChanges);
}

function smoothGpsPosition(latitude, longitude, accuracy, timestamp, speed) {
  gpsHistory.push({ latitude, longitude, accuracy: Math.max(accuracy || 50, 3), timestamp });
  gpsHistory = gpsHistory
    .filter((item) => timestamp - item.timestamp <= 8000)
    .slice(-7);

  let latitudeSum = 0;
  let longitudeSum = 0;
  let weightSum = 0;
  const smoothingTime = Number.isFinite(speed) && speed * 3.6 >= 15 ? 350 : 1800;
  for (const item of gpsHistory) {
    const ageFactor = Math.exp(-(timestamp - item.timestamp) / smoothingTime);
    const weight = ageFactor / (item.accuracy * item.accuracy);
    latitudeSum += item.latitude * weight;
    longitudeSum += item.longitude * weight;
    weightSum += weight;
  }
  return {
    latitude: latitudeSum / weightSum,
    longitude: longitudeSum / weightSum
  };
}

function distanceMetres(a, b) {
  const earthRadius = 6371000;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(b.longitude - a.longitude);
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function bearingDegrees(a, b) {
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const toDegrees = (radians) => radians * 180 / Math.PI;
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function saveSession() {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    version: 2,
    recording,
    savedAt: Date.now(),
    samples: samples.slice(-10000),
    stats,
    lastRecordedPoint
  }));
}

function updateRecordingControls() {
  recordButton.classList.toggle("recording", recording);
  recordButton.textContent = recording ? "■ Zastavit" : "● Záznam";
  exportButton.disabled = samples.length === 0;
}

function showGpsError(error) {
  const messages = {
    1: "Poloha zamítnuta",
    2: "Poloha nedostupná",
    3: "GPS neodpovídá"
  };

  gpsStatus.textContent = messages[error.code] || "Chyba GPS";
  speedValue.textContent = "--";
  console.warn("GPS chyba:", error.message);
}

function updatePosition(position) {
  const { latitude, longitude, speed, accuracy, altitude } = position.coords;
  const smoothed = smoothGpsPosition(latitude, longitude, accuracy, position.timestamp, speed);
  const coordinates = [smoothed.latitude, smoothed.longitude];
  const point = smoothed;
  let heading = Number.isFinite(position.coords.heading) ? position.coords.heading : null;

  if (heading === null && lastPoint && distanceMetres(lastPoint, point) >= 3) {
    heading = bearingDegrees(lastPoint, point);
  }

  appState.latestPosition = coordinates;
  gpsStatus.textContent = `±${Math.round(accuracy)} m`;
  headingValue.textContent = heading === null ? "--°" : `${Math.round(heading)}°`;
  speedValue.textContent = Number.isFinite(speed)
    ? String(Math.max(0, Math.round(speed * 3.6)))
    : "--";

  if (!trainMarker) {
    trainMarker = L.marker(coordinates, { icon: trainIcon }).addTo(map);
  } else {
    trainMarker.setLatLng(coordinates);
  }

  if (heading !== null) {
    trainMarker.getElement()?.querySelector(".train-marker-content")
      ?.style.setProperty("--heading", `${heading}deg`);
  }

  if (firstGpsFix) {
    map.setView(coordinates, 17);
    firstGpsFix = false;
  } else if (appState.following) {
    map.panTo(coordinates, { animate: true, duration: 0.35 });
  }

  if (recording) {
    const filteredPoint = { latitude: smoothed.latitude, longitude: smoothed.longitude };
    const rawPoint = { latitude, longitude };
    const speedKmh = Number.isFinite(speed) ? speed * 3.6 : null;
    if (lastRecordedPoint) {
      const stepDistance = distanceMetres(lastRecordedPoint, filteredPoint);
      if (stepDistance < 1000) stats.distanceMetres += stepDistance;
    }
    lastRecordedPoint = filteredPoint;
    if (speedKmh !== null) {
      stats.speedSum += speedKmh;
      stats.speedSamples += 1;
      stats.maxSpeed = Math.max(stats.maxSpeed, speedKmh);
    }
    if (Number.isFinite(accuracy)) {
      stats.accuracySum += accuracy;
      stats.accuracySamples += 1;
    }

    samples.push({
      time: new Date(position.timestamp).toISOString(),
      rawLatitude: latitude,
      rawLongitude: longitude,
      filteredLatitude: smoothed.latitude,
      filteredLongitude: smoothed.longitude,
      filterOffset: Math.round(distanceMetres(rawPoint, filteredPoint) * 10) / 10,
      accuracy: Math.round(accuracy * 10) / 10,
      speedKmh: Number.isFinite(speed) ? Math.round(speed * 36) / 10 : "",
      heading: heading === null ? "" : Math.round(heading),
      altitude: Number.isFinite(altitude) ? Math.round(altitude * 10) / 10 : "",
      trackId: "",
      trackLabel: "",
      trackDistance: "",
      trackConfidence: ""
    });
    trailLine.addLatLng(coordinates);
    updateStatsPanel();
    if (samples.length % 5 === 0) saveSession();
    exportButton.disabled = false;
  }

  lastPoint = point;

  window.dispatchEvent(new CustomEvent("railnavigator:position", {
    detail: {
      latitude: smoothed.latitude,
      longitude: smoothed.longitude,
      accuracy,
      heading,
      speedKmh: Number.isFinite(speed) ? speed * 3.6 : null
    }
  }));
}

recordButton.addEventListener("click", () => {
  recording = !recording;
  if (recording) {
    samples = [];
    stats = createEmptyStats();
    stats.startedAt = Date.now();
    lastRecordedPoint = null;
    lastMatchedWayId = null;
    trailLine.setLatLngs([]);
    clearInterval(statsTimer);
    statsTimer = setInterval(updateStatsPanel, 1000);
    saveSession();
    showNotice("Testovací záznam byl spuštěn. Data zůstávají v telefonu.");
  } else {
    stats.stoppedAt = Date.now();
    clearInterval(statsTimer);
    updateStatsPanel();
    saveSession();
    showNotice(`Záznam zastaven: ${samples.length} GPS bodů.`);
  }
  updateRecordingControls();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && (recording || samples.length)) saveSession();
});

window.addEventListener("pagehide", () => {
  if (recording || samples.length) saveSession();
});

exportButton.addEventListener("click", () => {
  if (!samples.length) return;
  const columns = [
    "time", "rawLatitude", "rawLongitude", "filteredLatitude", "filteredLongitude",
    "filterOffset", "accuracy", "speedKmh", "heading", "altitude",
    "trackId", "trackLabel", "trackDistance", "trackConfidence"
  ];
  const csvEscape = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const csv = [columns.join(","), ...samples.map((row) => columns.map((key) => csvEscape(row[key])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `railnavigator-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

summaryButton.addEventListener("click", () => {
  updateStatsPanel();
  testPanel.hidden = false;
});

closeSummaryButton.addEventListener("click", () => {
  testPanel.hidden = true;
});

window.addEventListener("railnavigator:track", (event) => {
  const track = event.detail;
  if (recording && lastMatchedWayId !== null && track.wayId !== lastMatchedWayId) {
    stats.trackChanges += 1;
  }
  lastMatchedWayId = track.wayId;
  const lastSample = samples[samples.length - 1];
  if (recording && lastSample) {
    lastSample.trackId = track.wayId;
    lastSample.trackLabel = track.label;
    lastSample.trackDistance = track.distance;
    lastSample.trackConfidence = track.confidence;
  }
});

try {
  const storedV2 = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "null");
  const storedLegacy = JSON.parse(localStorage.getItem("railnavigator-last-session") || "[]");
  if (storedV2?.version === 2 && Array.isArray(storedV2.samples)) {
    samples = storedV2.samples;
    stats = { ...createEmptyStats(), ...(storedV2.stats || {}) };
    lastRecordedPoint = storedV2.lastRecordedPoint || null;
    recording = Boolean(storedV2.recording);
    if (recording) {
      stats.stoppedAt = null;
      statsTimer = setInterval(updateStatsPanel, 1000);
      setTimeout(() => showNotice(`Záznam obnoven: ${samples.length} GPS bodů.`), 800);
    }
  } else if (Array.isArray(storedLegacy) && storedLegacy.length) {
    samples = storedLegacy;
  }
} catch (error) {
  console.warn("Poslední záznam se nepodařilo načíst:", error);
}
updateRecordingControls();

if (!navigator.geolocation) {
  gpsStatus.textContent = "Nepodporováno";
} else {
  navigator.geolocation.watchPosition(updatePosition, showGpsError, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 15000
  });
}
