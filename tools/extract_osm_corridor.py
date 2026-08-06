#!/usr/bin/env python3
"""Extract a compact railway layer for RailNavigator from an OSM GeoJSON export."""

from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path


DEFAULT_BBOX = (16.45, 48.95, 17.25, 49.35)
KEPT_PROPERTIES = (
    "@id",
    "railway",
    "railway:track_ref",
    "local_ref",
    "ref",
    "name",
    "service",
    "usage",
    "operator",
    "maxspeed",
)


def geometry_intersects_bbox(geometry: dict, bbox: tuple[float, float, float, float]) -> bool:
    if geometry.get("type") != "LineString":
        return False
    minimum_lon, minimum_lat, maximum_lon, maximum_lat = bbox
    return any(
        minimum_lon <= point[0] <= maximum_lon and minimum_lat <= point[1] <= maximum_lat
        for point in geometry.get("coordinates", [])
        if isinstance(point, list) and len(point) >= 2
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, help="GeoJSON exported from Overpass")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--bbox", nargs=4, type=float, default=DEFAULT_BBOX,
                        metavar=("MIN_LON", "MIN_LAT", "MAX_LON", "MAX_LAT"))
    args = parser.parse_args()

    source = json.loads(args.input.read_text(encoding="utf-8-sig"))
    features = []
    for feature in source.get("features", []):
        properties = feature.get("properties") or {}
        if properties.get("railway") != "rail":
            continue
        geometry = feature.get("geometry") or {}
        if not geometry_intersects_bbox(geometry, tuple(args.bbox)):
            continue
        coordinates = [point[:2] for point in geometry.get("coordinates", []) if len(point) >= 2]
        if len(coordinates) < 2:
            continue
        features.append({
            "type": "Feature",
            "id": properties.get("@id", feature.get("id", "")),
            "properties": {key: properties[key] for key in KEPT_PROPERTIES if properties.get(key) not in (None, "")},
            "geometry": {"type": "LineString", "coordinates": coordinates},
        })

    result = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "OpenStreetMap",
            "license": "ODbL 1.0",
            "source_url": "https://www.openstreetmap.org/",
            "retrieved_at": dt.date.today().isoformat(),
            "bbox": list(args.bbox),
            "feature_count": len(features),
        },
        "features": features,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(features)} railway features to {args.output}")


if __name__ == "__main__":
    main()
