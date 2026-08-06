#!/usr/bin/env python3
"""Convert public DMVS JVF ZIP files to compact railway-axis GeoJSON."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

TRACK_AXIS_CODE = "0100000021"


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def child_text(element: ET.Element, name: str) -> str:
    child = next((item for item in element.iter() if local_name(item.tag) == name), None)
    return (child.text or "").strip() if child is not None else ""


def track_reference(description: str) -> str:
    match = re.search(r"kolej\s*(?:č\.|číslo)?\s*([0-9]+[a-z]?)", description, re.IGNORECASE)
    return match.group(1) if match else ""


def parse_xml(xml_data: bytes, source_name: str) -> tuple[list[dict], str]:
    root = ET.fromstring(xml_data)
    date = child_text(root, "DatumZapisu")[:10]
    container = None
    for element in root.iter():
        if any(
            local_name(child.tag) == "ObjektovyTypNazev"
            and child.attrib.get("code_base") == TRACK_AXIS_CODE
            for child in list(element)[:3]
        ):
            container = element
            break
    if container is None:
        return [], date

    features = []
    for record in (item for item in container.iter() if local_name(item.tag) == "ZaznamObjektu"):
        pos_list = next((item for item in record.iter() if local_name(item.tag) == "posList"), None)
        if pos_list is None or not pos_list.text:
            continue
        values = [float(value) for value in pos_list.text.split()]
        if len(values) < 6 or len(values) % 3:
            continue
        coordinates = [values[index:index + 3] for index in range(0, len(values), 3)]
        description = child_text(record, "PopisObjektu")
        object_id = child_text(record, "ID")
        features.append({
            "type": "Feature",
            "id": object_id,
            "properties": {
                "id": object_id,
                "dmvs_type": TRACK_AXIS_CODE,
                "track_ref": track_reference(description),
                "popis_objektu": description if description.lower().startswith("kolej") else "",
                "year_surveyed": child_text(record, "RokGeodetickehoPorizeni"),
                "position_accuracy_class": child_text(record, "TridaPresnostiPoloha"),
                "height_accuracy_class": child_text(record, "TridaPresnostiVyska"),
                "source_file": source_name,
            },
            "geometry": {"type": "LineString", "coordinates": coordinates},
        })
    return features, date


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs", nargs="+", type=Path, help="JVF ZIP or XML files")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    all_features: list[dict] = []
    valid_dates: list[str] = []
    for path in args.inputs:
        if path.suffix.lower() == ".zip":
            with zipfile.ZipFile(path) as archive:
                xml_names = [name for name in archive.namelist() if name.lower().endswith(".xml")]
                for name in xml_names:
                    features, date = parse_xml(archive.read(name), path.name)
                    all_features.extend(features)
                    if date:
                        valid_dates.append(date)
        else:
            features, date = parse_xml(path.read_bytes(), path.name)
            all_features.extend(features)
            if date:
                valid_dates.append(date)

    unique = {feature["properties"]["id"]: feature for feature in all_features}
    result = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "ČÚZK/DMVS",
            "source_url": "https://dmvs.cuzk.gov.cz/portal/vydej-dat/verejne-datove-sady",
            "license": "CC BY 4.0",
            "license_url": "https://creativecommons.org/licenses/by/4.0/",
            "crs": "EPSG:5514",
            "valid_to": max(valid_dates) if valid_dates else "",
            "retrieved_at": dt.date.today().isoformat(),
            "object_type": TRACK_AXIS_CODE,
            "feature_count": len(unique),
        },
        "features": list(unique.values()),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(unique)} railway-axis features to {args.output}")


if __name__ == "__main__":
    main()
