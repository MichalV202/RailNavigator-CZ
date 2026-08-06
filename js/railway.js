"use strict";

const trackValue = document.getElementById("track");
const trackDistanceValue = document.getElementById("track-distance");
const trackConfidenceValue = document.getElementById("track-confidence");
const trackSourceValue = document.getElementById("track-source");
const OSM_DATA_URL = "./data/osm-railways.geojson";
const SEARCH_RADIUS_METRES = 320;
const MAX_TRACK_DISTANCE_METRES = 45;
const REFRESH_DISTANCE_METRES = 90;
const REFRESH_INTERVAL_MS = 30000;

let railwayWays = [];
let lastQueryPosition = null;
let lastQueryTime = 0;
let queryInProgress = false;
let lockedWayId = null;
let challengerWayId = null;
let challengerWins = 0;
let highlightedWayId = null;
let osmWays = [];
let osmMetadata = {};
let previousMatchedPoint = null;
const rollingScores = new Map();
const selectedTrackLine = L.polyline([], {
  color: "#00e5ff",
  weight: 6,
  opacity: 0.88,
  interactive: false,
  lineCap: "round"
}).addTo(map);
const supplementalTrackLabels = L.layerGroup().addTo(map);

function localPoint(latitude, longitude, originLatitude, originLongitude) {
  const latitudeScale = 111320;
  const longitudeScale = latitudeScale * Math.cos(originLatitude * Math.PI / 180);
  return {
    x: (longitude - originLongitude) * longitudeScale,
    y: (latitude - originLatitude) * latitudeScale,
    latitudeScale,
    longitudeScale
  };
}

function closestPointOnSegment(point, start, end) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared
  ));
  const x = start.x + ratio * deltaX;
  const y = start.y + ratio * deltaY;
  return { ratio, x, y, distance: Math.hypot(point.x - x, point.y - y) };
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
  return Math.min(direct, 360 - direct, Math.abs(180 - direct));
}

function orientBearing(bearing, reference) {
  if (!Number.isFinite(bearing) || !Number.isFinite(reference)) return bearing;
  const opposite = (bearing + 180) % 360;
  const directGap = Math.min(Math.abs(bearing - reference), 360 - Math.abs(bearing - reference));
  const oppositeGap = Math.min(Math.abs(opposite - reference), 360 - Math.abs(opposite - reference));
  return oppositeGap < directGap ? opposite : bearing;
}

function measureWay(position, geometry) {
  const origin = { latitude: position.latitude, longitude: position.longitude };
  const point = { x: 0, y: 0 };
  let result = { distance: Infinity, bearing: null, latitude: null, longitude: null, segmentIndex: 0 };
  for (let index = 1; index < geometry.length; index += 1) {
    const start = localPoint(geometry[index - 1].lat, geometry[index - 1].lon, origin.latitude, origin.longitude);
    const end = localPoint(geometry[index].lat, geometry[index].lon, origin.latitude, origin.longitude);
    const closest = closestPointOnSegment(point, start, end);
    if (closest.distance < result.distance) {
      result = {
        distance: closest.distance,
        bearing: segmentBearing(start, end),
        latitude: origin.latitude + closest.y / start.latitudeScale,
        longitude: origin.longitude + closest.x / start.longitudeScale,
        segmentIndex: index - 1
      };
    }
  }
  return result;
}

function describeTrack(tags = {}) {
  const trackReference = tags["railway:track_ref"] || tags.derived_track_ref || tags.local_ref;
  if (trackReference) return String(trackReference);
  if (tags.name) return tags.name;
  if (tags.ref) return `trať ${tags.ref}`;
  const services = { yard: "manipulační", siding: "vedlejší", spur: "vlečková", crossover: "spojovací" };
  return services[tags.service] || "bez označení";
}

function geometryMidpoint(geometry) {
  return geometry[Math.floor(geometry.length / 2)];
}

function interpolatePosition(from, to, distanceFromStart, totalDistance) {
  const ratio = totalDistance > 0 ? Math.max(0, Math.min(1, distanceFromStart / totalDistance)) : 0;
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * ratio,
    longitude: from.longitude + (to.longitude - from.longitude) * ratio
  };
}

function geometryAroundMatch(geometry, segmentIndex, matched, radiusMetres = 42) {
  const centre = { latitude: matched.latitude, longitude: matched.longitude };
  const before = [];
  const after = [];
  let cursor = centre;
  let remaining = radiusMetres;
  for (let index = segmentIndex; index >= 0 && remaining > 0; index -= 1) {
    const target = { latitude: geometry[index].lat, longitude: geometry[index].lon };
    const length = distanceBetweenPositions(cursor, target);
    if (length > remaining) {
      before.unshift(interpolatePosition(cursor, target, remaining, length));
      remaining = 0;
    } else {
      before.unshift(target);
      remaining -= length;
      cursor = target;
    }
  }
  cursor = centre;
  remaining = radiusMetres;
  for (let index = segmentIndex + 1; index < geometry.length && remaining > 0; index += 1) {
    const target = { latitude: geometry[index].lat, longitude: geometry[index].lon };
    const length = distanceBetweenPositions(cursor, target);
    if (length > remaining) {
      after.push(interpolatePosition(cursor, target, remaining, length));
      remaining = 0;
    } else {
      after.push(target);
      remaining -= length;
      cursor = target;
    }
  }
  return [...before, centre, ...after].map((point) => [point.latitude, point.longitude]);
}

function osmFeatureToWay(feature, index) {
  if (feature?.geometry?.type !== "LineString") return null;
  const geometry = feature.geometry.coordinates.map((point) => ({ lon: point[0], lat: point[1] }));
  if (geometry.length < 2) return null;
  const properties = feature.properties || {};
  return {
    id: properties["@id"] || feature.id || `osm-local:${index}`,
    geometry,
    tags: { ...properties, source: "OpenStreetMap" }
  };
}

async function loadLocalOsmData() {
  const response = await fetch(OSM_DATA_URL, { cache: "no-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  osmMetadata = data.metadata || {};
  osmWays = (data.features || []).map(osmFeatureToWay).filter(Boolean);
  return osmWays.length;
}

const osmReady = loadLocalOsmData().catch((error) => {
  console.warn("Lokální železniční podklad OSM se nepodařilo načíst:", error);
  osmWays = [];
  return 0;
});

function nearbyLocalOsmWays(position, radiusMetres) {
  const prefilterRadius = Math.max(radiusMetres * 1.35, 430);
  return osmWays.filter((way) => way.geometry.some((point) =>
    distanceBetweenPositions(position, { latitude: point.lat, longitude: point.lon }) <= prefilterRadius
  ));
}

function copyOsmReferencesToDmvs(dmvsWays, osmWays) {
  const labelledOsmWays = osmWays.filter((way) =>
    way.tags?.["railway:track_ref"] || way.tags?.local_ref || way.tags?.name
  );
  for (const osmWay of labelledOsmWays) {
    if (!Array.isArray(osmWay.geometry) || osmWay.geometry.length < 2) continue;
    const middle = geometryMidpoint(osmWay.geometry);
    const position = { latitude: middle.lat, longitude: middle.lon };
    const osmMeasurement = measureWay(position, osmWay.geometry);
    let nearest = null;
    for (const dmvsWay of dmvsWays) {
      const measurement = measureWay(position, dmvsWay.geometry);
      const bearingGap = directionDifference(osmMeasurement.bearing, measurement.bearing);
      if (bearingGap > 18) continue;
      if (!nearest || measurement.distance < nearest.distance) nearest = { way: dmvsWay, ...measurement };
    }
    if (nearest && nearest.distance <= 6) {
      const label = osmWay.tags["railway:track_ref"] || osmWay.tags.local_ref || osmWay.tags.name;
      if (!nearest.way.tags["railway:track_ref"] && !nearest.way.tags.derived_track_ref) {
        nearest.way.tags = {
          ...nearest.way.tags,
          derived_track_ref: String(label),
          label_source: "OpenStreetMap",
          osm_reference_id: String(osmWay.id)
        };
      }
    }
  }
}

function addPlatformReferences(elements) {
  const platformEdges = elements.filter((element) =>
    element.tags?.railway === "platform_edge" && element.tags?.ref
    && Array.isArray(element.geometry) && element.geometry.length >= 2
  );
  for (const edge of platformEdges) {
    const middle = geometryMidpoint(edge.geometry);
    const position = { latitude: middle.lat, longitude: middle.lon };
    let nearest = null;
    for (const way of railwayWays) {
      if (way.tags?.["railway:track_ref"] || way.tags?.derived_track_ref) continue;
      const measurement = measureWay(position, way.geometry);
      if (!nearest || measurement.distance < nearest.distance) nearest = { way, ...measurement };
    }
    if (nearest && nearest.distance <= 12) {
      nearest.way.tags = { ...nearest.way.tags, derived_track_ref: edge.tags.ref, label_source: "OpenStreetMap" };
    }
  }
}

function renderSupplementalLabels() {
  supplementalTrackLabels.clearLayers();
  if (map.getZoom() < 17) return;
  const occupied = [];
  for (const way of railwayWays) {
    const label = way.tags?.derived_track_ref;
    if (!label || !Array.isArray(way.geometry) || !way.geometry.length) continue;
    const middle = geometryMidpoint(way.geometry);
    if (occupied.some((item) => item.label === label && distanceBetweenPositions(item, {
      latitude: middle.lat, longitude: middle.lon
    }) < 80)) continue;
    occupied.push({ label, latitude: middle.lat, longitude: middle.lon });
    L.marker([middle.lat, middle.lon], { opacity: 0, interactive: false })
      .bindTooltip(String(label), {
        permanent: true, direction: "center", className: "supplemental-track-label", opacity: 1
      }).addTo(supplementalTrackLabels);
  }
}

function candidateScore(position, measurement, way) {
  const accuracy = Math.max(4, Number(position.accuracy) || 20);
  const distanceScore = measurement.distance * (8 / Math.min(accuracy, 24));
  const directionPenalty = Number.isFinite(position.heading) && Number(position.speedKmh) >= 1.5
    ? directionDifference(position.heading, measurement.bearing) * (Number(position.speedKmh) >= 8 ? 0.24 : 0.14)
    : 0;
  const unnamedPenalty = describeTrack(way.tags) === "bez označení" ? 0.35 : 0;
  const sourceBonus = way.tags?.source === "ČÚZK/DMVS" ? -0.4 : 0;
  let continuityPenalty = 0;
  if (previousMatchedPoint && String(way.id) !== String(lockedWayId)) {
    const candidateJump = distanceBetweenPositions(previousMatchedPoint, {
      latitude: measurement.latitude, longitude: measurement.longitude
    });
    const plausibleTravel = Math.max(12, (Number(position.speedKmh) || 0) * 0.75 + accuracy);
    continuityPenalty = Math.max(0, candidateJump - plausibleTravel) * 0.12;
  }
  return distanceScore + directionPenalty + unnamedPenalty + sourceBonus + continuityPenalty;
}

function updateNearestTrack(position) {
  if (!railwayWays.length) return;
  const candidates = [];
  for (const way of railwayWays) {
    if (!Array.isArray(way.geometry) || way.geometry.length < 2) continue;
    const measurement = measureWay(position, way.geometry);
    const instantScore = candidateScore(position, measurement, way);
    const previousScore = rollingScores.get(String(way.id));
    const stableScore = previousScore === undefined ? instantScore : previousScore * 0.55 + instantScore * 0.45;
    rollingScores.set(String(way.id), stableScore);
    candidates.push({ way, ...measurement, instantScore, stableScore });
  }
  candidates.sort((first, second) => first.stableScore - second.stableScore);
  if (!candidates.length) return;

  const best = candidates[0];
  let lockedCandidate = candidates.find((candidate) => String(candidate.way.id) === String(lockedWayId));
  let selected = lockedCandidate || best;
  let selectionReason = lockedCandidate ? "zachována předchozí kolej" : "počáteční výběr";
  if (!lockedCandidate) {
    lockedWayId = best.way.id;
    lockedCandidate = best;
  }

  const stationary = position.movementState === "stojí";
  const starting = position.movementState === "rozjíždí se";
  const allowedDistance = Math.max(MAX_TRACK_DISTANCE_METRES, Number(position.accuracy) || 0);
  const lockedLost = lockedCandidate.distance > allowedDistance * 1.5;
  const requiredWins = lockedLost ? 2 : stationary ? 14 : starting ? 3 : Number(position.speedKmh) < 5 ? 6 : 4;
  const requiredMargin = stationary ? 9 : Number(position.speedKmh) < 5 ? 4 : 2.4;

  if (String(best.way.id) !== String(lockedWayId)
      && (lockedLost || best.stableScore + requiredMargin < lockedCandidate.stableScore)) {
    if (String(challengerWayId) === String(best.way.id)) challengerWins += 1;
    else {
      challengerWayId = best.way.id;
      challengerWins = 1;
    }
    if (challengerWins >= requiredWins) {
      lockedWayId = best.way.id;
      selected = best;
      selectionReason = lockedLost ? "předchozí kolej opuštěna" : `potvrzeno ${challengerWins} body`;
      challengerWayId = null;
      challengerWins = 0;
    }
  } else {
    challengerWayId = null;
    challengerWins = 0;
  }

  const onTrack = selected.distance <= allowedDistance;
  const label = onTrack ? describeTrack(selected.way.tags) : "mimo kolej";
  trackValue.textContent = label;
  trackDistanceValue.textContent = `${Math.round(selected.distance)} m`;

  const second = candidates.find((candidate) => String(candidate.way.id) !== String(selected.way.id));
  const separation = second ? second.stableScore - selected.stableScore : 20;
  let confidence = "nízká";
  if (onTrack && Number(position.accuracy) <= 8 && separation >= 5 && selected.distance <= 8) confidence = "vysoká";
  else if (onTrack && Number(position.accuracy) <= 20 && separation >= 2.2 && selected.distance <= 18) confidence = "střední";
  trackConfidenceValue.textContent = confidence;

  if (highlightedWayId !== selected.way.id || selected.segmentIndex !== selectedTrackLine._railSegmentIndex) {
    highlightedWayId = selected.way.id;
    selectedTrackLine._railSegmentIndex = selected.segmentIndex;
    selectedTrackLine.setLatLngs(onTrack
      ? geometryAroundMatch(selected.way.geometry, selected.segmentIndex, selected)
      : []);
  }

  if (onTrack) previousMatchedPoint = { latitude: selected.latitude, longitude: selected.longitude };

  const detail = {
    wayId: selected.way.id,
    label,
    labelSource: selected.way.tags?.label_source || selected.way.tags?.source || "OpenStreetMap",
    geometrySource: selected.way.tags?.source || "OpenStreetMap",
    distance: Math.round(selected.distance * 10) / 10,
    confidence,
    matchedLatitude: onTrack ? selected.latitude : position.latitude,
    matchedLongitude: onTrack ? selected.longitude : position.longitude,
    trackBearing: orientBearing(selected.bearing, position.heading),
    selectionReason,
    challengerId: challengerWayId || "",
    challengerWins,
    candidates: candidates.slice(0, 3).map((candidate) => ({
      wayId: candidate.way.id,
      label: describeTrack(candidate.way.tags),
      distance: Math.round(candidate.distance * 10) / 10,
      score: Math.round(candidate.stableScore * 100) / 100
    }))
  };
  window.dispatchEvent(new CustomEvent("railnavigator:track", { detail }));
}

async function loadRailways(position) {
  queryInProgress = true;
  trackValue.textContent = "hledám…";
  let dmvsNearbyWays = [];

  try {
    const dmvs = window.RailNavigatorDMVS;
    if (dmvs) {
      await dmvs.ready;
      dmvsNearbyWays = dmvs.getNearbyWays(position, SEARCH_RADIUS_METRES);
    }
    await osmReady;
    const localOsmWays = nearbyLocalOsmWays(position, SEARCH_RADIUS_METRES);
    copyOsmReferencesToDmvs(dmvsNearbyWays, localOsmWays);
    const supplementalOsmWays = dmvsNearbyWays.length
      ? localOsmWays.filter((way) => {
          if (!Array.isArray(way.geometry) || !way.geometry.length) return false;
          const middle = geometryMidpoint(way.geometry);
          return dmvsNearbyWays.every((dmvsWay) => measureWay({
            latitude: middle.lat, longitude: middle.lon
          }, dmvsWay.geometry).distance > 8);
        })
      : localOsmWays;
    railwayWays = [...dmvsNearbyWays, ...supplementalOsmWays];
    renderSupplementalLabels();
    if (dmvsNearbyWays.length && localOsmWays.length) trackSourceValue.textContent = "ČÚZK + OSM lokálně";
    else if (dmvsNearbyWays.length) trackSourceValue.textContent = "ČÚZK";
    else if (localOsmWays.length) trackSourceValue.textContent = "OSM lokálně";
    else trackSourceValue.textContent = "mimo stažený podklad";
    lastQueryPosition = position;
    lastQueryTime = Date.now();
    rollingScores.clear();
    if (!railwayWays.length) {
      trackValue.textContent = "nenalezena";
      trackDistanceValue.textContent = "-- m";
      trackConfidenceValue.textContent = "--";
      selectedTrackLine.setLatLngs([]);
      supplementalTrackLabels.clearLayers();
    } else updateNearestTrack(position);
  } catch (error) {
    trackValue.textContent = "data nedostupná";
    console.warn("Načtení lokálních železničních dat selhalo:", error);
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
