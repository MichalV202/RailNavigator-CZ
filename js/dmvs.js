"use strict";

const DMVS_DATA_URL = "./data/dmvs-railways.geojson";
const dmvsSourceValue = document.getElementById("track-source");
let dmvsWays = [];
const dmvsGrid = new Map();
const GRID_SIZE_DEGREES = 0.004;

if (window.proj4) {
  proj4.defs(
    "EPSG:5514",
    "+proj=krovak +lat_0=49.5 +lon_0=24.8333333333333 +alpha=30.2881397527778 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=572.213,85.334,461.94,-4.9732,-1.529,-5.2484,3.5378 +units=m +no_defs"
  );
}

function setDmvsStatus(text) {
  if (dmvsSourceValue) dmvsSourceValue.textContent = text;
}

function featureToWay(feature, index, sourceCrs) {
  if (feature?.geometry?.type !== "LineString" || !Array.isArray(feature.geometry.coordinates)) return null;
  const geometry = feature.geometry.coordinates
    .filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map((point) => {
      const transformed = sourceCrs === "EPSG:5514" && window.proj4
        ? proj4("EPSG:5514", "EPSG:4326", [point[0], point[1]])
        : [point[0], point[1]];
      return {
        lon: transformed[0],
        lat: transformed[1],
        elevation: Number.isFinite(point[2]) && point[2] !== 0 ? point[2] : null
      };
    })
    .filter((point) => point.lat >= 48 && point.lat <= 51.5 && point.lon >= 12 && point.lon <= 19.5);
  if (geometry.length < 2) return null;
  const properties = feature.properties || {};
  return {
    id: `dmvs:${properties.id || feature.id || index}`,
    geometry,
    tags: {
      railway: "rail",
      "railway:track_ref": properties.track_ref || properties.oznaceni_koleje || "",
      ref: properties.route_ref || properties.oznaceni_trate || "",
      name: properties.name || properties.popis_objektu || "",
      source: "ČÚZK/DMVS",
      dmvs_type: properties.dmvs_type || "0100000021"
    }
  };
}

function approximateDistanceMetres(position, point) {
  const latitudeScale = 111320;
  const longitudeScale = latitudeScale * Math.cos(position.latitude * Math.PI / 180);
  return Math.hypot(
    (point.lat - position.latitude) * latitudeScale,
    (point.lon - position.longitude) * longitudeScale
  );
}

function gridKey(latitude, longitude) {
  return `${Math.floor(latitude / GRID_SIZE_DEGREES)}:${Math.floor(longitude / GRID_SIZE_DEGREES)}`;
}

function buildDmvsGrid() {
  dmvsGrid.clear();
  dmvsWays.forEach((way, index) => {
    const occupied = new Set(way.geometry.map((point) => gridKey(point.lat, point.lon)));
    occupied.forEach((key) => {
      if (!dmvsGrid.has(key)) dmvsGrid.set(key, []);
      dmvsGrid.get(key).push(index);
    });
  });
}

function candidateWayIndexes(position, radiusMetres) {
  const latitudeCells = Math.ceil(radiusMetres / 111320 / GRID_SIZE_DEGREES) + 1;
  const longitudeScale = Math.max(30000, 111320 * Math.cos(position.latitude * Math.PI / 180));
  const longitudeCells = Math.ceil(radiusMetres / longitudeScale / GRID_SIZE_DEGREES) + 1;
  const centreLatitude = Math.floor(position.latitude / GRID_SIZE_DEGREES);
  const centreLongitude = Math.floor(position.longitude / GRID_SIZE_DEGREES);
  const indexes = new Set();
  for (let y = -latitudeCells; y <= latitudeCells; y += 1) {
    for (let x = -longitudeCells; x <= longitudeCells; x += 1) {
      (dmvsGrid.get(`${centreLatitude + y}:${centreLongitude + x}`) || []).forEach((index) => indexes.add(index));
    }
  }
  return indexes;
}

async function loadDmvsData() {
  try {
    const response = await fetch(DMVS_DATA_URL, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) throw new Error("Neplatný GeoJSON");
    const sourceCrs = data.metadata?.crs || "EPSG:4326";
    if (sourceCrs === "EPSG:5514" && !window.proj4) throw new Error("Chybí převod souřadnic proj4");
    dmvsWays = data.features.map((feature, index) => featureToWay(feature, index, sourceCrs)).filter(Boolean);
    if (!dmvsWays.length) throw new Error("Datová sada neobsahuje osy kolejí");
    buildDmvsGrid();
    const validTo = data.metadata?.valid_to || data.metadata?.date || "2026";
    setDmvsStatus(`ČÚZK ${validTo}`);
    map.attributionControl.addAttribution(
      '<a href="https://dmvs.cuzk.gov.cz/portal/vydej-dat/verejne-datove-sady" target="_blank">ČÚZK/DMVS</a>, 2026 · <a href="https://creativecommons.org/licenses/by/4.0/deed.cs" target="_blank">CC BY 4.0</a>'
    );
    return { available: true, count: dmvsWays.length, metadata: data.metadata || {} };
  } catch (error) {
    setDmvsStatus("OSM (záloha)");
    console.info("Lokální data DMVS zatím nejsou vložena, používám OpenStreetMap.", error);
    return { available: false, count: 0, metadata: {} };
  }
}

const dmvsReady = loadDmvsData();

window.RailNavigatorDMVS = {
  ready: dmvsReady,
  getNearbyWays(position, radiusMetres) {
    const prefilterRadius = Math.max(radiusMetres * 1.5, 500);
    return [...candidateWayIndexes(position, prefilterRadius)].map((index) => dmvsWays[index]).filter((way) =>
      way && way.geometry.some((point) =>
      approximateDistanceMetres(position, point) <= prefilterRadius
      )
    );
  }
};
