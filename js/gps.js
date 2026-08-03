"use strict";

const speedValue = document.getElementById("speed-value");
const gpsStatus = document.getElementById("gps-status");
const headingValue = document.getElementById("heading");
const recordButton = document.getElementById("record-button");
const exportButton = document.getElementById("export-button");

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
  localStorage.setItem("railnavigator-last-session", JSON.stringify(samples.slice(-10000)));
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
    samples.push({
      time: new Date(position.timestamp).toISOString(),
      latitude,
      longitude,
      accuracy: Math.round(accuracy * 10) / 10,
      speedKmh: Number.isFinite(speed) ? Math.round(speed * 36) / 10 : "",
      heading: heading === null ? "" : Math.round(heading),
      altitude: Number.isFinite(altitude) ? Math.round(altitude * 10) / 10 : ""
    });
    if (samples.length % 10 === 0) saveSession();
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
    showNotice("Testovací záznam byl spuštěn. Data zůstávají v telefonu.");
  } else {
    saveSession();
    showNotice(`Záznam zastaven: ${samples.length} GPS bodů.`);
  }
  updateRecordingControls();
});

exportButton.addEventListener("click", () => {
  if (!samples.length) return;
  const columns = ["time", "latitude", "longitude", "accuracy", "speedKmh", "heading", "altitude"];
  const csv = [columns.join(","), ...samples.map((row) => columns.map((key) => row[key]).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `railnavigator-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

try {
  const stored = JSON.parse(localStorage.getItem("railnavigator-last-session") || "[]");
  if (Array.isArray(stored) && stored.length) samples = stored;
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
