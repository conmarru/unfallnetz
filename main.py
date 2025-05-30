from flask import Flask
from flask_socketio import SocketIO
from src.heatmap import register_heatmap_routes
import asyncio

from src import CollectionHandler
from src import Config
from src.routes import register_routes
from src.websocket import register_websocket
from src.database import initialize_db
from src.updater import update_system

# App- und SocketIO-Initialisierung
app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")
collection = CollectionHandler()

# Heatmap-Routen anmelden
register_heatmap_routes(app)

# Standard- und Websocket-Routen registrieren
register_routes(app)
register_websocket(socketio, collection)

async def main():
    # Konfiguration laden
    app.config.from_object(Config)

    # Datenbank initialisieren
    url = app.config.get("SOURCE_URL")
    uri = app.config.get("MONGODB_URI")
    try:
        initialize_db(collection, url, uri)
    except Exception as e:
        print("Warnung: Keine Verbindung zu MongoDB möglich.", e)

    # Hintergrund-Aufgaben starten: SocketIO-Server und Updater
    socketio_task = asyncio.to_thread(
        lambda: socketio.run(app, host="0.0.0.0", port=5000, debug=True, use_reloader=False)
    )
    update_task = asyncio.create_task(update_system(url, collection, socketio))
    await asyncio.gather(socketio_task, update_task)

if __name__ == '__main__':
    asyncio.run(main())
