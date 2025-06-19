"""
Utilities for spatial assignment of event points to street segments
using Shapely and spatial indexing for performance.
"""
import requests
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree


def fetch_street_segments(bbox, overpass_url='http://overpass-api.de/api/interpreter'):
    """
    Fetches OSM highway ways within the given bbox via Overpass API and returns
    a list of shapely LineString segments (between consecutive nodes) and a parallel list of their unique segment-IDs.

    :param bbox: String "south,west,north,east"
    :param overpass_url: Overpass API endpoint
    :returns: (segments, seg_ids)
        segments: list of LineString (individual way segments)
        seg_ids: list of corresponding "wayID_index" strings
    """
    query = f'[out:json][timeout:25];way["highway"]({bbox});out geom;'
    resp = requests.post(overpass_url, data={'data': query}, timeout=30)
    resp.raise_for_status()
    osm = resp.json()

    segments = []
    seg_ids = []
    for elem in osm.get('elements', []):
        if elem.get('type') != 'way':
            continue
        coords = [(pt['lon'], pt['lat']) for pt in elem.get('geometry', [])]
        # split the way into individual segments between consecutive nodes
        for i in range(len(coords) - 1):
            start = coords[i]
            end   = coords[i + 1]
            segments.append(LineString([start, end]))
            # unique segment ID combining way id and index
            seg_ids.append(f"{elem.get('id')}_{i}")
    return segments, seg_ids


def assign_events_to_segments(events, bbox):
    """
    Assigns each event point to the nearest street segment within the bbox,
    aggregates counts and computes a dangerLevel per segment.

    :param events: list of GeoJSON-like Features with 'geometry':{'coordinates':[lon,lat]}
    :param bbox: String "south,west,north,east"
    :returns: dict mapping segment_id -> dangerLevel (0,1,2)
    """
    # Fetch street segments
    lines, ids = fetch_street_segments(bbox)
    if not lines:
        return {}

    # Build spatial index
    tree = STRtree(lines)
    # Preload numpy for type checking
    import numpy as np

    # Temporary aggregation container
    agg = {}

    for feat in events:
        coords = feat.get('geometry', {}).get('coordinates', [])
        if len(coords) != 2:
            continue
        lon, lat = coords
        pt = Point(lon, lat)

        # Query candidate segments
        candidates = tree.query(pt)
        # shapely >=2.0 returns indices instead of geometries
        if candidates and isinstance(candidates[0], (int, np.integer)):
            candidates = [lines[i] for i in candidates]
        if not candidates:
            continue

        # Find nearest by explicit distance
        nearest = min(candidates, key=lambda seg: seg.distance(pt))
        # Map back to segment ID
        idx = lines.index(nearest)
        seg_id = ids[idx]

        entry = agg.setdefault(seg_id, {'events': 0, 'accidents': 0})
        entry['events'] += 1

        props = feat.get('properties', {})
        sev = props.get('severity', 0)
        if sev >= 2 or props.get('accident', False):
            entry['accidents'] += 1

    # Compute danger levels: 0=none,1=yellow,2=red
    danger_levels = {}
    for seg_id, counts in agg.items():
        if counts['accidents'] >= 1 or counts['events'] >= 2:
            danger_levels[seg_id] = 2
        else:
            danger_levels[seg_id] = 1

    return danger_levels
