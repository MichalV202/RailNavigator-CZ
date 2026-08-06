"use strict";

const speedValue = document.getElementById("speed-value");
const gpsStatus = document.getElementById("gps-status");
const headingValue = document.getElementById("heading");
const recordButton = document.getElementById("record-button");
const exportButton = document.getElementById("export-button");
const summaryButton = document.getElementById("summary-button");
const testPanel = document.getElementById("test-panel");
const closeSummaryButton = document.getElementById("close-summary-button");
const noteButton = document.getElementById("note-button");
const notePanel = document.getElementById("note-panel");
const closeNoteButton = document.getElementById("close-note-button");
const customNote = document.getElementById("custom-note");
const saveCustomNote = document.getElementById("save-custom-note");
const SESSION_STORAGE_KEY = "railnavigator-session-v3";
const DB_NAME = "railnavigator-recordings";
const DB_VERSION = 1;

const trainIcon = L.divIcon({
  className: "train-icon",
  html: '<span class="train-marker-content"><span class="train-arrow">▲</span><span>🚆</span></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

let trainMarker = null;
let firstGpsFix = true;
let lastFilteredPoint = null;
let latestFix = null;
let latestTrack = null;
let recording = false;
let samples = [];
let gpsHistory = [];
let motionHistory = [];
let lastRecordedPoint = null;
let lastMatchedWayId = null;
let statsTimer = null;
let currentSessionId = null;
let displayedSpeed = null;
let lastSpeedSourceAt = 0;
let movementState = "určuje se";
let movementEvidence = 0;
let stoppingEvidence = 0;
let stationaryMatchedAnchor = null;
let lastReliableHeading = null;
let trackEventCounter = 0;
let markerAnimationFrame = null;
let markerAnimationStartedAt = 0;
let markerAnimationFrom = null;
let markerAnimationTarget = null;
let lastMarkerTargetAt = 0;
let stats = createEmptyStats();
const trailLine = L.polyline([], {
  color: "#ffcc00", weight: 4, opacity: 0.9, interactive: false
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
    trackChanges: 0,
    networkBytesAtStart: Number(appState.networkBytes || 0)
  };
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor(totalSeconds % 3600 / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatSpeedometerValue(speedKmh) {
  if (!Number.isFinite(speedKmh)) return "--";
  const speed = Math.max(0, speedKmh);
  return speed.toFixed(1).replace(".", ",");
}

function updateStatsPanel() {
  const endTime = recording ? Date.now() : (stats.stoppedAt || Date.now());
  const duration = stats.startedAt ? endTime - stats.startedAt : 0;
  const averageSpeed = stats.speedSamples ? stats.speedSum / stats.speedSamples : 0;
  const averageAccuracy = stats.accuracySamples ? stats.accuracySum / stats.accuracySamples : null;
  const sessionBytes = Math.max(0, Number(appState.networkBytes || 0) - Number(stats.networkBytesAtStart || 0));
  document.getElementById("stat-duration").textContent = formatDuration(duration);
  document.getElementById("stat-distance").textContent = `${(stats.distanceMetres / 1000).toFixed(2)} km`;
  document.getElementById("stat-average-speed").textContent = `${Math.round(averageSpeed)} km/h`;
  document.getElementById("stat-max-speed").textContent = `${Math.round(stats.maxSpeed)} km/h`;
  document.getElementById("stat-average-accuracy").textContent = averageAccuracy === null ? "-- m" : `${Math.round(averageAccuracy)} m`;
  document.getElementById("stat-samples").textContent = String(samples.length);
  document.getElementById("stat-track-changes").textContent = String(stats.trackChanges);
  document.getElementById("stat-data-usage").textContent = formatBytes(sessionBytes);
  document.getElementById("stat-movement-state").textContent = movementState;
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

function smoothGpsPosition(latitude, longitude, accuracy, timestamp, speed) {
  gpsHistory.push({ latitude, longitude, accuracy: Math.max(accuracy || 50, 3), timestamp });
  gpsHistory = gpsHistory.filter((item) => timestamp - item.timestamp <= 7000).slice(-7);
  let latitudeSum = 0;
  let longitudeSum = 0;
  let weightSum = 0;
  const speedKmh = Number.isFinite(speed) ? speed * 3.6 : 0;
  const smoothingTime = speedKmh >= 12 ? 280 : speedKmh >= 3 ? 700 : 1400;
  for (const item of gpsHistory) {
    const ageFactor = Math.exp(-(timestamp - item.timestamp) / smoothingTime);
    const weight = ageFactor / (item.accuracy * item.accuracy);
    latitudeSum += item.latitude * weight;
    longitudeSum += item.longitude * weight;
    weightSum += weight;
  }
  return { latitude: latitudeSum / weightSum, longitude: longitudeSum / weightSum };
}

function calculateMotion(point, rawSpeedKmh, accuracy, timestamp) {
  motionHistory.push({ ...point, timestamp });
  motionHistory = motionHistory.filter((item) => timestamp - item.timestamp <= 9000);
  const reference = [...motionHistory].reverse().find((item) => timestamp - item.timestamp >= 1600)
    || motionHistory[0];
  const longReference = [...motionHistory].reverse().find((item) => timestamp - item.timestamp >= 3600)
    || motionHistory[0];
  const elapsed = Math.max(0.2, (timestamp - reference.timestamp) / 1000);
  const longElapsed = Math.max(0.2, (timestamp - longReference.timestamp) / 1000);
  const netDistance = distanceMetres(reference, point);
  const longNetDistance = distanceMetres(longReference, point);
  const relevantHistory = motionHistory.filter((item) => item.timestamp >= reference.timestamp);
  let pathDistance = 0;
  for (let index = 1; index < relevantHistory.length; index += 1) {
    pathDistance += distanceMetres(relevantHistory[index - 1], relevantHistory[index]);
  }
  const movementCoherence = pathDistance > 0 ? netDistance / pathDistance : 0;
  const calculatedSpeedKmh = netDistance / elapsed * 3.6;
  const noiseRadius = Math.max(3, Math.min(8, (Number(accuracy) || 20) * 0.42));
  const reliableRaw = Number.isFinite(rawSpeedKmh) ? rawSpeedKmh : null;
  const strongMovement = (reliableRaw !== null && reliableRaw >= 1.4)
    || (elapsed >= 1.6 && netDistance > noiseRadius * 0.75
      && calculatedSpeedKmh >= 0.9 && movementCoherence >= 0.55);
  const weakMovement = (reliableRaw !== null && reliableRaw >= 0.6)
    && elapsed >= 1.6 && netDistance > noiseRadius * 0.35 && movementCoherence >= 0.65;
  const looksStopped = longElapsed >= 3.6 && longNetDistance <= noiseRadius * 0.9
    && (reliableRaw === null || reliableRaw <= 1.4);

  if (movementState === "určuje se") {
    if (strongMovement) movementState = "jede";
    else if (timestamp - motionHistory[0].timestamp >= 3800) movementState = "stojí";
  } else if (movementState === "stojí") {
    if (strongMovement || weakMovement) movementEvidence += 1;
    else movementEvidence = Math.max(0, movementEvidence - 1);
    if (movementEvidence >= 1) movementState = "rozjíždí se";
  } else if (movementState === "rozjíždí se") {
    if (strongMovement || weakMovement) movementEvidence += 1;
    else movementEvidence = Math.max(0, movementEvidence - 1);
    if (movementEvidence >= 2) {
      movementState = "jede";
      movementEvidence = 0;
    } else if (looksStopped && movementEvidence === 0) movementState = "stojí";
  } else if (movementState === "jede") {
    if (looksStopped) stoppingEvidence += 1;
    else stoppingEvidence = Math.max(0, stoppingEvidence - 1);
    if (stoppingEvidence >= 2) {
      movementState = "zastavuje";
      stoppingEvidence = 0;
    }
  } else if (movementState === "zastavuje") {
    if (strongMovement) movementState = "jede";
    else if (looksStopped) stoppingEvidence += 1;
    else stoppingEvidence = Math.max(0, stoppingEvidence - 1);
    if (stoppingEvidence >= 1) {
      movementState = "stojí";
      movementEvidence = 0;
      stoppingEvidence = 0;
      stationaryMatchedAnchor = null;
    }
  }

  let combinedSpeed = null;
  if (movementState === "stojí") combinedSpeed = 0;
  else if (reliableRaw !== null) {
    const calculatedIsPlausible = Math.abs(calculatedSpeedKmh - reliableRaw) <= Math.max(6, reliableRaw * 0.6);
    combinedSpeed = calculatedIsPlausible
      ? reliableRaw * 0.84 + calculatedSpeedKmh * 0.16
      : reliableRaw;
    lastSpeedSourceAt = timestamp;
  } else if (calculatedSpeedKmh <= 80) {
    combinedSpeed = calculatedSpeedKmh;
    lastSpeedSourceAt = timestamp;
  } else if (timestamp - lastSpeedSourceAt <= 3000) combinedSpeed = displayedSpeed;

  if (combinedSpeed !== null) {
    const alpha = displayedSpeed === null || combinedSpeed > displayedSpeed ? 0.72 : 0.58;
    displayedSpeed = displayedSpeed === null ? combinedSpeed : displayedSpeed + alpha * (combinedSpeed - displayedSpeed);
    if (movementState === "stojí") displayedSpeed = 0;
    if (displayedSpeed < 0.7 && movementState !== "jede") displayedSpeed = 0;
  } else displayedSpeed = null;

  return {
    calculatedSpeedKmh,
    displayedSpeedKmh: displayedSpeed,
    movementState,
    movementDecisionReason: `raw=${reliableRaw ?? "--"}; výpočet=${calculatedSpeedKmh.toFixed(1)}; posun3s=${netDistance.toFixed(1)}m; posun6s=${longNetDistance.toFixed(1)}m; souvislost=${movementCoherence.toFixed(2)}; šum=${noiseRadius.toFixed(1)}m`
  };
}

function openRecordingDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("IndexedDB není podporována"));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("state")) database.createObjectStore("state", { keyPath: "id" });
      if (!database.objectStoreNames.contains("samples")) database.createObjectStore("samples", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const databasePromise = openRecordingDatabase().catch((error) => {
  console.info("Používám záložní ukládání relace.", error);
  return null;
});

async function persistSample(sample, index) {
  const database = await databasePromise;
  if (!database || !currentSessionId) return;
  const transaction = database.transaction("samples", "readwrite");
  transaction.objectStore("samples").put({
    key: `${currentSessionId}|${String(index).padStart(8, "0")}`,
    sessionId: currentSessionId,
    index,
    sample
  });
}

async function persistSession() {
  const database = await databasePromise;
  if (!database) {
    const fallback = {
      version: 3, recording, savedAt: Date.now(), sessionId: currentSessionId,
      samples: samples.slice(-10000), stats, lastRecordedPoint
    };
    try { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(fallback)); } catch (error) {
      console.info("Záložní lokální úložiště je plné.", error);
    }
    return;
  }
  const transaction = database.transaction("state", "readwrite");
  transaction.objectStore("state").put({
    id: "active", version: 3, recording, savedAt: Date.now(), sessionId: currentSessionId,
    stats, lastRecordedPoint, sampleCount: samples.length
  });
}

async function clearPersistentSamples() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
  const database = await databasePromise;
  if (!database) return;
  const transaction = database.transaction(["samples", "state"], "readwrite");
  transaction.objectStore("samples").clear();
  transaction.objectStore("state").delete("active");
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function restoreSession() {
  const database = await databasePromise;
  if (database) {
    const state = await requestResult(database.transaction("state", "readonly").objectStore("state").get("active"));
    if (state?.version === 3 && state.sessionId) {
      const range = IDBKeyRange.bound(`${state.sessionId}|`, `${state.sessionId}|\uffff`);
      const entries = await requestResult(database.transaction("samples", "readonly").objectStore("samples").getAll(range));
      entries.sort((a, b) => a.index - b.index);
      samples = entries.map((entry) => entry.sample);
      currentSessionId = state.sessionId;
      stats = { ...createEmptyStats(), ...(state.stats || {}) };
      lastRecordedPoint = state.lastRecordedPoint || null;
      recording = Boolean(state.recording);
      return;
    }
  }
  const stored = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "null");
  if (stored?.version === 3 && Array.isArray(stored.samples)) {
    samples = stored.samples;
    currentSessionId = stored.sessionId || `restored-${Date.now()}`;
    stats = { ...createEmptyStats(), ...(stored.stats || {}) };
    lastRecordedPoint = stored.lastRecordedPoint || null;
    recording = Boolean(stored.recording);
  }
}

function updateRecordingControls() {
  recordButton.classList.toggle("recording", recording);
  recordButton.textContent = recording ? "■ Zastavit" : "● Záznam";
  exportButton.disabled = samples.length === 0;
  noteButton.disabled = !recording;
}

function showGpsError(error) {
  const messages = { 1: "Poloha zamítnuta", 2: "Poloha nedostupná", 3: "GPS neodpovídá" };
  gpsStatus.textContent = messages[error.code] || "Chyba GPS";
  speedValue.textContent = "--";
  console.warn("GPS chyba:", error.message);
}

function renderVehicle(latitude, longitude, heading) {
  const coordinates = [latitude, longitude];
  appState.matchedPosition = coordinates;
  const now = performance.now();
  if (!trainMarker) {
    trainMarker = L.marker(coordinates, { icon: trainIcon, zIndexOffset: 900 }).addTo(map);
    markerAnimationTarget = coordinates;
  } else {
    if (markerAnimationFrame) cancelAnimationFrame(markerAnimationFrame);
    const current = trainMarker.getLatLng();
    markerAnimationFrom = [current.lat, current.lng];
    markerAnimationTarget = coordinates;
    markerAnimationStartedAt = now;
    const updateInterval = lastMarkerTargetAt ? now - lastMarkerTargetAt : 1000;
    const duration = Math.max(350, Math.min(1400, updateInterval * 0.92));
    const animate = (frameTime) => {
      const progress = Math.max(0, Math.min(1, (frameTime - markerAnimationStartedAt) / duration));
      const eased = progress * (2 - progress);
      trainMarker.setLatLng([
        markerAnimationFrom[0] + (markerAnimationTarget[0] - markerAnimationFrom[0]) * eased,
        markerAnimationFrom[1] + (markerAnimationTarget[1] - markerAnimationFrom[1]) * eased
      ]);
      if (progress < 1) markerAnimationFrame = requestAnimationFrame(animate);
      else markerAnimationFrame = null;
    };
    markerAnimationFrame = requestAnimationFrame(animate);
  }
  lastMarkerTargetAt = now;
  if (Number.isFinite(heading)) {
    lastReliableHeading = heading;
    trainMarker.getElement()?.querySelector(".train-marker-content")
      ?.style.setProperty("--heading", `${heading}deg`);
  }
  if (firstGpsFix) {
    map.setView(coordinates, 17);
    firstGpsFix = false;
  } else if (appState.following && !map.getBounds().pad(-0.32).contains(coordinates)) {
    map.panTo(coordinates, { animate: true, duration: 0.55 });
  }
}

function updatePosition(position) {
  const { latitude, longitude, speed, accuracy, altitude } = position.coords;
  const rawSpeedKmh = Number.isFinite(speed) ? speed * 3.6 : null;
  const smoothed = smoothGpsPosition(latitude, longitude, accuracy, position.timestamp, speed);
  const point = { latitude: smoothed.latitude, longitude: smoothed.longitude };
  const rawPoint = { latitude, longitude };
  const motion = calculateMotion(point, rawSpeedKmh, accuracy, position.timestamp);
  let heading = Number.isFinite(position.coords.heading) ? position.coords.heading : null;
  if (heading === null && lastFilteredPoint && distanceMetres(lastFilteredPoint, point) >= 2.5) {
    heading = bearingDegrees(lastFilteredPoint, point);
  }
  if (Number.isFinite(heading) && motion.movementState !== "stojí") lastReliableHeading = heading;

  latestFix = {
    time: new Date(position.timestamp).toISOString(), rawPoint, point, accuracy, altitude,
    rawSpeedKmh, heading, ...motion
  };
  appState.latestPosition = [point.latitude, point.longitude];
  gpsStatus.textContent = `±${Math.round(accuracy)} m`;
  headingValue.textContent = Number.isFinite(lastReliableHeading) ? `${Math.round(lastReliableHeading)}°` : "--°";
  speedValue.textContent = formatSpeedometerValue(motion.displayedSpeedKmh);

  let sample = null;
  if (recording) {
    if (lastRecordedPoint) {
      const stepDistance = distanceMetres(lastRecordedPoint, point);
      if (stepDistance < 100 && motion.movementState !== "stojí") stats.distanceMetres += stepDistance;
    }
    lastRecordedPoint = point;
    if (Number.isFinite(motion.displayedSpeedKmh)) {
      stats.speedSum += motion.displayedSpeedKmh;
      stats.speedSamples += 1;
      stats.maxSpeed = Math.max(stats.maxSpeed, motion.displayedSpeedKmh);
    }
    if (Number.isFinite(accuracy)) {
      stats.accuracySum += accuracy;
      stats.accuracySamples += 1;
    }
    sample = {
      time: latestFix.time,
      eventType: "gps",
      rawLatitude: latitude,
      rawLongitude: longitude,
      filteredLatitude: point.latitude,
      filteredLongitude: point.longitude,
      matchedLatitude: "",
      matchedLongitude: "",
      filterOffset: Math.round(distanceMetres(rawPoint, point) * 10) / 10,
      accuracy: Math.round(accuracy * 10) / 10,
      rawSpeedKmh: rawSpeedKmh === null ? "" : Math.round(rawSpeedKmh * 10) / 10,
      calculatedSpeedKmh: Math.round(motion.calculatedSpeedKmh * 10) / 10,
      displayedSpeedKmh: Number.isFinite(motion.displayedSpeedKmh) ? Math.round(motion.displayedSpeedKmh * 10) / 10 : "",
      heading: heading === null ? "" : Math.round(heading),
      altitude: Number.isFinite(altitude) ? Math.round(altitude * 10) / 10 : "",
      movementState: motion.movementState,
      movementDecisionReason: motion.movementDecisionReason,
      trackId: "",
      trackLabel: "",
      trackDistance: "",
      trackConfidence: "",
      geometrySource: "",
      labelSource: "",
      selectionReason: "",
      candidate1: "",
      candidate2: "",
      candidate3: "",
      visibilityState: document.visibilityState,
      online: navigator.onLine,
      networkBytes: Math.max(0, Number(appState.networkBytes || 0) - Number(stats.networkBytesAtStart || 0)),
      noteTime: "",
      userNote: ""
    };
    samples.push(sample);
    persistSample(sample, samples.length - 1).catch(console.warn);
    if (samples.length % 5 === 0) persistSession().catch(console.warn);
    updateStatsPanel();
  }

  const beforeTrackEvent = trackEventCounter;
  window.dispatchEvent(new CustomEvent("railnavigator:position", {
    detail: {
      latitude: point.latitude,
      longitude: point.longitude,
      accuracy,
      heading: Number.isFinite(heading) ? heading : lastReliableHeading,
      speedKmh: motion.displayedSpeedKmh,
      rawSpeedKmh,
      movementState: motion.movementState,
      timestamp: position.timestamp
    }
  }));
  if (trackEventCounter === beforeTrackEvent) {
    const fallback = movementState === "stojí" && stationaryMatchedAnchor
      ? stationaryMatchedAnchor : point;
    renderVehicle(fallback.latitude, fallback.longitude, lastReliableHeading);
    if (recording) trailLine.addLatLng([fallback.latitude, fallback.longitude]);
  }
  lastFilteredPoint = point;
}

window.addEventListener("railnavigator:track", (event) => {
  trackEventCounter += 1;
  const track = event.detail;
  latestTrack = track;
  if (recording && lastMatchedWayId !== null && String(track.wayId) !== String(lastMatchedWayId)) {
    stats.trackChanges += 1;
  }
  lastMatchedWayId = track.wayId;

  const matched = { latitude: track.matchedLatitude, longitude: track.matchedLongitude };
  if (movementState === "stojí") {
    if (!stationaryMatchedAnchor) stationaryMatchedAnchor = matched;
  } else stationaryMatchedAnchor = null;
  const displayedPoint = stationaryMatchedAnchor || matched;
  const markerHeading = Number.isFinite(track.trackBearing) ? track.trackBearing : lastReliableHeading;
  renderVehicle(displayedPoint.latitude, displayedPoint.longitude, markerHeading);

  const lastSample = samples[samples.length - 1];
  if (recording && lastSample && latestFix && lastSample.time === latestFix.time) {
    lastSample.matchedLatitude = matched.latitude;
    lastSample.matchedLongitude = matched.longitude;
    lastSample.trackId = track.wayId;
    lastSample.trackLabel = track.label;
    lastSample.trackDistance = track.distance;
    lastSample.trackConfidence = track.confidence;
    lastSample.geometrySource = track.geometrySource;
    lastSample.labelSource = track.labelSource;
    lastSample.selectionReason = track.selectionReason;
    [lastSample.candidate1, lastSample.candidate2, lastSample.candidate3] = track.candidates.map((candidate) =>
      `${candidate.wayId}|${candidate.label}|${candidate.distance}m|${candidate.score}`
    );
    persistSample(lastSample, samples.length - 1).catch(console.warn);
    trailLine.addLatLng([matched.latitude, matched.longitude]);
  }
});

recordButton.addEventListener("click", async () => {
  recording = !recording;
  if (recording) {
    await clearPersistentSamples();
    samples = [];
    stats = createEmptyStats();
    stats.startedAt = Date.now();
    currentSessionId = new Date().toISOString();
    lastRecordedPoint = null;
    lastMatchedWayId = null;
    trailLine.setLatLngs([]);
    clearInterval(statsTimer);
    statsTimer = setInterval(updateStatsPanel, 1000);
    await persistSession();
    showNotice("Testovací záznam byl spuštěn. Data se průběžně ukládají v telefonu.");
  } else {
    stats.stoppedAt = Date.now();
    clearInterval(statsTimer);
    updateStatsPanel();
    await persistSession();
    showNotice(`Záznam zastaven: ${samples.length} GPS bodů.`);
  }
  updateRecordingControls();
});

document.addEventListener("visibilitychange", () => {
  if (recording || samples.length) persistSession().catch(console.warn);
});
window.addEventListener("pagehide", () => {
  if (recording || samples.length) persistSession().catch(console.warn);
});
window.addEventListener("online", () => showNotice("Připojení bylo obnoveno."));
window.addEventListener("offline", () => showNotice("Bez internetu – záznam pokračuje lokálně."));

exportButton.addEventListener("click", () => {
  if (!samples.length) return;
  const columns = [
    "time", "eventType", "rawLatitude", "rawLongitude", "filteredLatitude", "filteredLongitude",
    "matchedLatitude", "matchedLongitude", "filterOffset", "accuracy", "rawSpeedKmh",
    "calculatedSpeedKmh", "displayedSpeedKmh", "heading", "altitude", "movementState",
    "movementDecisionReason", "trackId", "trackLabel", "trackDistance", "trackConfidence",
    "geometrySource", "labelSource", "selectionReason", "candidate1", "candidate2", "candidate3",
    "visibilityState", "online", "networkBytes", "noteTime", "userNote"
  ];
  const csvEscape = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const csv = "\ufeff" + [columns.join(","), ...samples.map((row) =>
    columns.map((key) => csvEscape(row[key])).join(",")
  )].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `railnavigator-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

summaryButton.addEventListener("click", () => {
  updateStatsPanel();
  testPanel.hidden = false;
});
closeSummaryButton.addEventListener("click", () => { testPanel.hidden = true; });

function storeUserNote(text) {
  const note = String(text || "").trim();
  if (!recording || !note) return;
  const lastSample = samples[samples.length - 1];
  if (!lastSample) return;
  const now = new Date().toISOString();
  lastSample.noteTime = now;
  lastSample.userNote = lastSample.userNote ? `${lastSample.userNote}; ${note}` : note;
  persistSample(lastSample, samples.length - 1).catch(console.warn);
  persistSession().catch(console.warn);
  notePanel.hidden = true;
  customNote.value = "";
  showNotice(`Poznámka uložena: ${note}`);
}

noteButton.addEventListener("click", () => { if (recording) notePanel.hidden = false; });
closeNoteButton.addEventListener("click", () => { notePanel.hidden = true; });
notePanel.querySelectorAll("[data-note]").forEach((button) => {
  button.addEventListener("click", () => storeUserNote(button.dataset.note));
});
saveCustomNote.addEventListener("click", () => storeUserNote(customNote.value));
customNote.addEventListener("keydown", (event) => {
  if (event.key === "Enter") storeUserNote(customNote.value);
});

restoreSession().then(() => {
  if (recording) {
    stats.stoppedAt = null;
    statsTimer = setInterval(updateStatsPanel, 1000);
    setTimeout(() => showNotice(`Záznam obnoven: ${samples.length} GPS bodů.`), 800);
  }
  updateRecordingControls();
  updateStatsPanel();
}).catch((error) => {
  console.warn("Poslední záznam se nepodařilo obnovit:", error);
  updateRecordingControls();
});

if (!navigator.geolocation) gpsStatus.textContent = "Nepodporováno";
else navigator.geolocation.watchPosition(updatePosition, showGpsError, {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 15000
});
