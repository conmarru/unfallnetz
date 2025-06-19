import requests
from flask import jsonify, current_app, request
from .utils_spatial import assign_events_to_segments, fetch_street_segments


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
                "geometry": {"type": "Point", "coordinates": [lon, lat]}
            })

        return jsonify({"type": "FeatureCollection", "features": features})

    @app.route('/api/streets')
    def streets_api():
        """
        Liefert nur Straßensegmente mit Ereignissen:
        dangerLevel 1 (Gelb) oder 2 (Rot).
        """
        bbox = request.args.get('bbox')
        if not bbox:
            return jsonify({"error": "bbox fehlt"}), 400

        # 1) Events laden
        try:
            events = list(collection_handler.find())
        except Exception:
            current_app.logger.error("Fehler beim Abrufen der Unfalldaten", exc_info=True)
            return jsonify({"error": "Datenbankfehler"}), 500

        # 2) DangerMap berechnen
        try:
            danger_map = assign_events_to_segments(events, bbox)
        except Exception:
            current_app.logger.error("Fehler bei spatial-Assignment", exc_info=True)
            return jsonify({"error": "Zuweisung fehlgeschlagen"}), 500

        # 3) Geometrie holen
        try:
            lines, ids = fetch_street_segments(bbox)
        except Exception:
            current_app.logger.error("Fehler beim Abrufen der Straßen-Geometrie", exc_info=True)
            return jsonify({"error": "Straßen-Daten nicht verfügbar"}), 502

        # 4) FeatureCollection aufbauen
        features = []
        for line, sid in zip(lines, ids):
            lvl = danger_map.get(sid, 0)
            if lvl > 0:
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": list(line.coords)},
                    "properties": {"dangerLevel": lvl}
                })

        current_app.logger.info(f"API /api/streets liefert {len(features)} gefärbte Segmente")
        return jsonify({"type": "FeatureCollection", "features": features})
