# src/heatmap.py

import requests
from flask import jsonify, current_app, request

def register_heatmap_routes(app, collection_handler):
    @app.route('/api/heatmap')
    def heatmap_api():
        try:
            docs = list(collection_handler.find())
        except Exception:
            current_app.logger.error("Fehler beim Abrufen der Unfalldaten", exc_info=True)
            return jsonify({"error": "Datenbankfehler"}), 500

        features = []
        for doc in docs:
            coords = doc.get("geometry", {}).get("coordinates", [])
            if len(coords) != 2:
                continue
            lon, lat = coords
            props = doc.get("properties", {})
            level = props.get("severity") or props.get("gefahrenstufe") or 1
            features.append({
                "type": "Feature",
                "properties": {"gefahrenstufe": level},
                "geometry": {
                    "type": "Point",
                    "coordinates": [lon, lat]
                }
            })

        return jsonify({
            "type": "FeatureCollection",
            "features": features
        })

    @app.route('/api/streets')
    def streets_api():
        """
        Liefert alle OSM-Highway-Ways innerhalb der übergebenen bbox als GeoJSON.
        Verwendet Overpass API, f=html-Parameter entfällt.
        """
        bbox = request.args.get('bbox')
        if not bbox:
            return jsonify({"error": "bbox fehlt"}), 400

        overpass_url = 'http://overpass-api.de/api/interpreter'
        # Overpass QL: alle Ways mit highway-Tag in bbox
        query = f'[out:json][timeout:25];way["highway"]({bbox});out geom;'
        try:
            resp = requests.post(overpass_url, data={'data': query}, timeout=30)
            resp.raise_for_status()
            osm = resp.json()
        except Exception:
            current_app.logger.error("Fehler beim Abrufen der Overpass-Daten", exc_info=True)
            return jsonify({"error": "Straßen-Daten nicht verfügbar"}), 502

        features = []
        for elem in osm.get('elements', []):
            if elem.get('type') != 'way':
                continue
            geometry = elem.get('geometry', [])
            # Baue LineString-Koordinatenliste
            coords = [[node['lon'], node['lat']] for node in geometry]
            if len(coords) < 2:
                continue
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": coords
                },
                "properties": {
                    # dangerLevel wird clientseitig berechnet
                    "id": elem.get('id')
                }
            })

        return jsonify({
            "type": "FeatureCollection",
            "features": features
        })
