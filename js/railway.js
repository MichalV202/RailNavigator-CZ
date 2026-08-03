"use strict";

const trackValue = document.getElementById("track");
const trackDistanceValue = document.getElementById("track-distance");
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const SEARCH_RADIUS_METRES = 150;
const MAX_TRACK_DISTANCE_METRES = 45;
const REFRESH_DISTANCE_METRES = 100;
const REFRESH_INTERVAL_MS = 30000;

let railwayWays = [];
let lastQueryPosition = null;
let lastQueryTime = 0;
let queryInProgress = false;

function localPoint(latitude, longitude, originLatitude, originLongitude) {
  const metresPerDegreeLatitude = 111320;
  const metresPerDegreeLongitude = 111320 * Math.cos(originLatitude * Math.PI / 180);
  return {
    x: (longitude - originLongitude) * metresPerDegreeLongitude,
    y: (latitude - originLatitude) * metresPerDegreeLatitude
  };
}

function pointToSegmentDistance(point, start, end) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(0, Math.min(1,
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared
  ));
  return Math.hypot(point.x - (start.x + ratio * deltaX), point.y - (start.y + ratio * deltaY));
}

function distanceBetweenPositions(first, second) {
  const point = localPoint(second.latitude, second.longitude, first.latitude, first.longitude);
  return Math.hypot(point.x, point.y);
}

function distanceToWay(position, geometry) {
  const point = { x: 0, y: 0 };
  let shortest = Infinity;
  for (let index = 1; index < geometry.length; index += 1) {
    const start = localPoint(geometry[index - 1].lat, geometry[index - 1].lon, position.latitude, position.longitude);
    const end = localPoint(geometry[index].lat, geometry[index].lon, position.latitude, position.longitude);
    shortest = Math.min(shortest, pointToSegmentDistance(point, start, end));
  }
  return shortest;
}

function describeTrack(tags = {}) {
  const trackReference = tags["railway:track_ref"] || tags.local_ref;
  if (trackReference) return String(trackReference);
  if (tags.ref) return `trať ${tags.ref}`;
  if (tags.name) return tags.name;
  const services = {
    yard: "manipulační",
    siding: "vedlejší",
    spur: "vlečková",
    crossover: "spojovací"
  };
  return services[tags.service] || "bez označení";
}

function updateNearestTrack(position) {
  if (!railwayWays.length) return;
  let nearest = null;
  for (const way of railwayWays) {
    if (!Array.isArray(way.geometry) || way.geometry.length < 2) continue;
    const distance = distanceToWay(position, way.geometry);
    if (!nearest || distance < nearest.distance) nearest = { way, distance };
  }
  if (!nearest) return;

  trackDistanceValue.textContent = `${Math.round(nearest.distance)} m`;
  const allowedDistance = Math.max(MAX_TRACK_DISTANCE_METRES, Number(position.accuracy) || 0);
  trackValue.textContent = nearest.distance <= allowedDistance
    ? describeTrack(nearest.way.tags)
    : "mimo kolej";
}

async function loadRailways(position) {
  queryInProgress = true;
  trackValue.textContent = "hledám…";
  const query = `[out:json][timeout:10];way(around:${SEARCH_RADIUS_METRES},${position.latitude},${position.longitude})[railway~"^(rail|light_rail|narrow_gauge)$"];out tags geom;`;

  try {
    const response = await fetch(`${OVERPASS_URL}?data=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    railwayWays = Array.isArray(data.elements) ? data.elements : [];
    lastQueryPosition = position;
    lastQueryTime = Date.now();
    if (!railwayWays.length) {
      trackValue.textContent = "nenalezena";
      trackDistanceValue.textContent = "-- m";
    } else {
      updateNearestTrack(position);
    }
  } catch (error) {
    trackValue.textContent = "data nedostupná";
    console.warn("Načtení železničních dat selhalo:", error);
  } finally {
    queryInProgress = false;
  }
}

window.addEventListener("railnavigator:position", (event) => {
  const position = event.detail;
  updateNearestTrack(position);
  const movedFarEnough = !lastQueryPosition
    || distanceBetweenPositions(lastQueryPosition, position) >= REFRESH_DISTANCE_METRES;
  const waitedLongEnough = Date.now() - lastQueryTime >= REFRESH_INTERVAL_MS;
  if (!queryInProgress && movedFarEnough && waitedLongEnough) loadRailways(position);
});
