# src/heatmap.py

from flask import jsonify, current_app, request
import requests  # für Hamburg-API-Aufruf
# TODO: Wenn 'requests' nicht vorhanden, alternativ urllib verwenden.

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
        # bbox= minLon,minLat,maxLon,maxLat
        bbox = request.args.get('bbox', '')
        try:
            min_lon, min_lat, max_lon, max_lat = map(float, bbox.split(','))
        except Exception:
            return jsonify({"error": "Ungültige bbox-Parameter"}), 400

        # Hamburg-Querschnitte-API (GeoJSON via f=json + bbox) :contentReference[oaicite:1]{index=1}
        hamburg_url = (
            "https://api.hamburg.de/datasets/v1/querschnitte/api/items"
            f"?f=json&bbox={min_lon},{min_lat},{max_lon},{max_lat}"
        )
        try:
            resp = requests.get(hamburg_url, timeout=10)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            current_app.logger.error("Fehler beim Abrufen der Straßen-API", exc_info=True)
            return jsonify({"error": "Straßen-API-Fehler"}), 502

        features = data.get("features", [])
        out_features = []

        for feat in features:
            geom = feat.get("geometry")
            props = feat.get("properties", {})

            # Events in der Nähe (50 m) zählen
            try:
                nearby = list(collection_handler.find({
                    "geometry": {
                        "$near": {
                            "$geometry": geom,
                            "$maxDistance": 50
                        }
                    }
                }))
            except Exception:
                nearby = []

            count = len(nearby)
            # Unfall prüfen (severity == 'accident' o. ä.)
            has_accident = any(
                ev.get("properties", {}).get("severity") == "accident"
                for ev in nearby
            )

            # dangerLevel: 0=keine, 1=ein Nicht-Unfall, 2=Unfall oder ≥2
            if count == 0:
                level = 0
            elif has_accident or count >= 2:
                level = 2
            else:
                level = 1

            # Ergebnis-Feature
            new_props = props.copy()
            new_props.update({
                "eventCount": count,
                "dangerLevel": level
            })
            out_features.append({
                "type": "Feature",
                "geometry": geom,
                "properties": new_props
            })

        return jsonify({
            "type": "FeatureCollection",
            "features": out_features
        })
