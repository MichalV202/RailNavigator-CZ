"use strict";

const speedValue = document.getElementById("speed-value");
const gpsStatus = document.getElementById("gps-status");

const trainIcon = L.divIcon({
  className: "train-icon",
  html: "🚆",
  iconSize: [42, 42],
  iconAnchor: [21, 21]
});

let trainMarker = null;
let firstGpsFix = true;

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
  const { latitude, longitude, speed, accuracy } = position.coords;
  const coordinates = [latitude, longitude];

  latestPosition = coordinates;
  gpsStatus.textContent = `±${Math.round(accuracy)} m`;
  speedValue.textContent = Number.isFinite(speed)
    ? String(Math.max(0, Math.round(speed * 3.6)))
    : "--";

  if (!trainMarker) {
    trainMarker = L.marker(coordinates, { icon: trainIcon }).addTo(map);
  } else {
    trainMarker.setLatLng(coordinates);
  }

  if (firstGpsFix) {
    map.setView(coordinates, 17);
    firstGpsFix = false;
  }
}

if (!navigator.geolocation) {
  gpsStatus.textContent = "Nepodporováno";
} else {
  navigator.geolocation.watchPosition(updatePosition, showGpsError, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 15000
  });
}

