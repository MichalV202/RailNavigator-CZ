"use strict";

const trackValue = document.getElementById("track");
const trackDistanceValue = document.getElementById("track-distance");
const trackConfidenceValue = document.getElementById("track-confidence");
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const SEARCH_RADIUS_METRES = 350;
const MAX_TRACK_DISTANCE_METRES = 45;
const REFRESH_DISTANCE_METRES = 100;
const REFRESH_INTERVAL_MS = 30000;

let railwayWays = [];
let lastQueryPosition = null;
let lastQueryTime = 0;
let queryInProgress = false;
let lockedWayId = null;
let challengerWayId = null;
let challengerWins = 0;
let highlightedWayId = null;
const selectedTrackLine = L.polyline([], {
  color: "#00e5ff",
  weight: 6,
  opacity: 0.85,
  interactive: false
}).addTo(map);
const supplementalTrackLabels = L.layerGroup().addTo(map);

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

function segmentBearing(start, end) {
  return (Math.atan2(end.x - start.x, end.y - start.y) * 180 / Math.PI + 360) % 360;
}

function directionDifference(first, second) {
  const direct = Math.abs(first - second) % 360;
  const opposite = Math.abs(first - ((second + 180) % 360)) % 360;
  return Math.min(direct, 360 - direct, opposite, 360 - opposite);
}

function measureWay(position, geometry) {
  const point = { x: 0, y: 0 };
  let result = { distance: Infinity, bearing: null };
  for (let index = 1; index < geometry.length; index += 1) {
    const start = localPoint(geometry[index - 1].lat, geometry[index - 1].lon, position.latitude, position.longitude);
    const end = localPoint(geometry[index].lat, geometry[index].lon, position.latitude, position.longitude);
    const distance = pointToSegmentDistance(point, start, end);
    if (distance < result.distance) result = { distance, bearing: segmentBearing(start, end) };
  }
  return result;
}

function describeTrack(tags = {}) {
  const trackReference = tags["railway:track_ref"] || tags.derived_track_ref || tags.local_ref;
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

function geometryMidpoint(geometry) {
  return geometry[Math.floor(geometry.length / 2)];
}

function addSupplementalTrackReferences(elements) {
  const platformEdges = elements.filter((element) =>
    element.tags?.railway === "platform_edge"
    && element.tags?.ref
    && Array.isArray(element.geometry)
    && element.geometry.length >= 2
  );

  for (const edge of platformEdges) {
    const middle = geometryMidpoint(edge.geometry);
    const position = { latitude: middle.lat, longitude: middle.lon };
    let nearest = null;
    for (const way of railwayWays) {
      if (way.tags?.["railway:track_ref"] || !Array.isArray(way.geometry)) continue;
      const measurement = measureWay(position, way.geometry);
      if (!nearest || measurement.distance < nearest.distance) nearest = { way, ...measurement };
    }
    if (nearest && nearest.distance <= 25) {
      nearest.way.tags = { ...nearest.way.tags, derived_track_ref: edge.tags.ref };
    }
  }
}

function renderSupplementalLabels() {
  supplementalTrackLabels.clearLayers();
  if (map.getZoom() < 17) return;
  const shown = new Set();
  for (const way of railwayWays) {
    const label = way.tags?.derived_track_ref;
    if (!label || shown.has(label) || !Array.isArray(way.geometry) || !way.geometry.length) continue;
    shown.add(label);
    const middle = geometryMidpoint(way.geometry);
    L.marker([middle.lat, middle.lon], { opacity: 0, interactive: false })
      .bindTooltip(String(label), {
        permanent: true,
        direction: "center",
        className: "supplemental-track-label",
        opacity: 1
      })
      .addTo(supplementalTrackLabels);
  }
}

function updateNearestTrack(position) {
  if (!railwayWays.length) return;
  const candidates = [];
  for (const way of railwayWays) {
    if (!Array.isArray(way.geometry) || way.geometry.length < 2) continue;
    const measurement = measureWay(position, way.geometry);
    const directionPenalty = Number.isFinite(position.heading) && Number(position.speedKmh) >= 4
      ? directionDifference(position.heading, measurement.bearing) * 0.12
      : 0;
    candidates.push({ way, ...measurement, score: measurement.distance + directionPenalty });
  }
  candidates.sort((first, second) => first.score - second.score);
  if (!candidates.length) return;

  const best = candidates[0];
  const lockedCandidate = candidates.find((candidate) => candidate.way.id === lockedWayId);
  let selected = lockedCandidate || best;
  if (lockedWayId === null || !lockedCandidate) lockedWayId = best.way.id;

  if (best.way.id !== lockedWayId && best.score + 6 < selected.score) {
    if (challengerWayId === best.way.id) challengerWins += 1;
    else {
      challengerWayId = best.way.id;
      challengerWins = 1;
    }
    if (challengerWins >= 4) {
      lockedWayId = best.way.id;
      selected = best;
      challengerWayId = null;
      challengerWins = 0;
    }
  } else {
    challengerWayId = null;
    challengerWins = 0;
  }

  trackDistanceValue.textContent = `${Math.round(selected.distance)} m`;
  const allowedDistance = Math.max(MAX_TRACK_DISTANCE_METRES, Number(position.accuracy) || 0);
  trackValue.textContent = selected.distance <= allowedDistance
    ? describeTrack(selected.way.tags)
    : "mimo kolej";

  const second = candidates.find((candidate) => candidate.way.id !== selected.way.id);
  const separation = second ? second.score - selected.score : 20;
  let confidence = "nízká";
  if (Number(position.accuracy) <= 8 && separation >= 6) confidence = "vysoká";
  else if (Number(position.accuracy) <= 20 && separation >= 3) confidence = "střední";
  trackConfidenceValue.textContent = confidence;

  if (highlightedWayId !== selected.way.id) {
    highlightedWayId = selected.way.id;
    selectedTrackLine.setLatLngs(selected.way.geometry.map((point) => [point.lat, point.lon]));
  }

  window.dispatchEvent(new CustomEvent("railnavigator:track", {
    detail: {
      wayId: selected.way.id,
      label: trackValue.textContent,
      distance: Math.round(selected.distance * 10) / 10,
      confidence
    }
  }));
}

async function loadRailways(position) {
  queryInProgress = true;
  trackValue.textContent = "hledám…";
  const query = `[out:json][timeout:12];(way(around:${SEARCH_RADIUS_METRES},${position.latitude},${position.longitude})[railway~"^(rail|light_rail|narrow_gauge)$"];way(around:${SEARCH_RADIUS_METRES},${position.latitude},${position.longitude})[railway="platform_edge"][ref];);out tags geom;`;

  try {
    const response = await fetch(`${OVERPASS_URL}?data=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const elements = Array.isArray(data.elements) ? data.elements : [];
    railwayWays = elements.filter((element) => /^(rail|light_rail|narrow_gauge)$/.test(element.tags?.railway || ""));
    addSupplementalTrackReferences(elements);
    renderSupplementalLabels();
    lastQueryPosition = position;
    lastQueryTime = Date.now();
    if (!railwayWays.length) {
      trackValue.textContent = "nenalezena";
      trackDistanceValue.textContent = "-- m";
      trackConfidenceValue.textContent = "--";
      selectedTrackLine.setLatLngs([]);
      supplementalTrackLabels.clearLayers();
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

map.on("zoomend", renderSupplementalLabels);
