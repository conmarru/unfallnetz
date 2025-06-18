// static/js/script.js

// 1. Globaler Zustand und Konstanten
const AppState = {
  themes: [
    { name: 'Standard',    url: 'https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/styles/bm_web_col.json' },
    { name: 'Alternative', url: 'mapbox://styles/mapbox/streets-v11' },
    { name: 'Dark',        url: 'mapbox://styles/mapbox/dark-v10' },
    { name: 'Light',       url: 'mapbox://styles/mapbox/light-v10' }
  ],
  currentTheme: 0,
  modes: ['Punkte', 'Heatmap', 'Straßenmodus'],
  currentMode: 0,
  markers: [],

  heat: {
    sourceId: 'heatmap-data',
    layerId:  'heatmap-layer'
  },

  // Für GeoJSON-Backup im Standard-Theme
  streetsGeo: {
    sourceId: 'street-data',
    layerId:  'street-layer'
  },

  districts: {
    'Eimsbüttel': {
      'Schanzenviertel': [9.963, 53.564],
      'Hoheluft-West':   [9.973, 53.579],
      'Eppendorf':       [9.982, 53.581]
    },
    'Altona': {
      'Ottensen':        [9.933, 53.554],
      'Altona-Altstadt': [9.935, 53.546],
      'Bahrenfeld':      [9.906, 53.565]
    },
    'Hamburg-Mitte': {
      'St. Pauli': [9.966, 53.550],
      'HafenCity': [10.002,53.541],
      'Altstadt':  [10.001,53.550]
    }
  }
};

// 2. Mapbox Access Token
mapboxgl.accessToken = 'pk.eyJ1IjoiM25heWNpIiwiYSI6ImNtOXhkY2g4MjB4OWUycHM2MTVvbGtyZ2IifQ.WqFxG56wGUk61umdzIM1aQ';

// 3. Helferfunktionen
function addControls(map) {
  map.addControl(new mapboxgl.NavigationControl());
  map.addControl(new mapboxgl.ScaleControl({ maxWidth:100, unit:'metric' }), 'bottom-left');
  map.addControl(new mapboxgl.GeolocateControl({
    positionOptions: { enableHighAccuracy:true },
    trackUserLocation: true,
    showUserHeading: true
  }), 'top-right');
  map.addControl(new mapboxgl.FullscreenControl(), 'top-right');
}

function computeColorByAge(date) {
  const days = (Date.now() - date)/(1000*60*60*24);
  if(days<=0) return 'rgb(0,255,0)';
  if(days<=7){
    const r=Math.round(255*(days/7)), g=Math.round(255*(1-days/7));
    return `rgb(${r},${g},0)`;
  }
  if(days<=14){
    const g=Math.round(255*(1-(days-7)/7));
    return `rgb(255,${g},0)`;
  }
  if(days<=30){
    const gray=Math.round(128+127*((days-14)/16));
    return `rgb(${gray},${gray},${gray})`;
  }
  return 'rgb(200,200,200)';
}
function computeOpacityByAge(date) {
  const days=(Date.now()-date)/(1000*60*60*24);
  return days<=30 ? 1 - Math.min(days/60,0.6) : 0.4;
}

// 4. Heatmap
function ensureHeatmapLayer(map, geojson) {
  const { sourceId, layerId } = AppState.heat;
  if(map.getSource(sourceId)) {
    map.getSource(sourceId).setData(geojson);
  } else {
    map.addSource(sourceId, { type:'geojson', data:geojson });
    map.addLayer({
      id: layerId,
      type: 'heatmap',
      source: sourceId,
      maxzoom: 17,
      paint: {
        'heatmap-weight':    ['get','gefahrenstufe'],
        'heatmap-intensity': 1,
        'heatmap-radius':    25,
        'heatmap-opacity':   0.6,
        'heatmap-color': [
          'interpolate',['linear'],['heatmap-density'],
          0,'rgba(0,0,255,0)',
          0.2,'blue',
          0.4,'lime',
          0.6,'yellow',
          0.8,'orange',
          1,'red'
        ]
      }
    });
  }
}
function loadHeatmapData() {
  fetch('/api/heatmap')
    .then(r=>r.json())
    .then(fc=>ensureHeatmapLayer(map,fc))
    .catch(e=>console.error('Heatmap Error',e));
}

// 5. Straßenmodus (Feature-State auf composite roads)
function initRoadDangerLayer() {
  if(map.getLayer('road-danger')) return;
  const style = map.getStyle();
  if(!style.sources.composite) return; // fallback, nicht composite vorhanden

  const roadLayers = style.layers
    .filter(l=>l.type==='line' && l.source==='composite' && l['source-layer']==='road')
    .map(l=>l.id);
  const beforeId = roadLayers.length ? roadLayers[roadLayers.length-1] : undefined;

  map.addLayer({
    id: 'road-danger',
    type: 'line',
    source: 'composite',
    'source-layer': 'road',
    paint: {
      'line-width': ['interpolate',['linear'],['zoom'],10,1,15,3],
      'line-color': [
        'case',
        ['==',['feature-state','dangerLevel'],2],'red',
        ['==',['feature-state','dangerLevel'],1],'yellow'
      ]
    }
  }, beforeId);
}

function updateRoadDangerStates() {
  const b = map.getBounds();
  const url = `/api/streets?bbox=${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
  fetch(url)
    .then(r=>r.json())
    .then(fc=>{
      fc.features.forEach(f=>{
        const [lon,lat] = f.geometry.coordinates;
        const lvl = f.properties.dangerLevel;
        const delta = 0.0005;
        const bbox = [[lon-delta,lat-delta],[lon+delta,lat+delta]];
        const hits = map.queryRenderedFeatures(bbox, { layers:['road-danger'] });
        hits.forEach(rf=>{
          if(rf.id!=null){
            map.setFeatureState({
              source: rf.source,
              sourceLayer: rf.sourceLayer,
              id: rf.id
            }, { dangerLevel: lvl });
          }
        });
      });
    })
    .catch(e=>console.error('Road-Mode Error',e));
}

function enableCompositeStreetMode() {
  initRoadDangerLayer();
  updateRoadDangerStates();
  map.on('moveend', updateRoadDangerStates);
  map.on('zoomend', updateRoadDangerStates);
}

function disableCompositeStreetMode() {
  map.off('moveend', updateRoadDangerStates);
  map.off('zoomend', updateRoadDangerStates);
}

// 6. GeoJSON-Fallback für Standard-Theme
function loadGeoJSONStreetData() {
  const b = map.getBounds();
  const bbox = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
  fetch(`/api/streets?bbox=${bbox}`)
    .then(r=>r.json())
    .then(fc=>{
      // berechne client-seitig dangerLevel = 0 (nur blau)
      fc.features.forEach(f=>f.properties.dangerLevel=0);
      const { sourceId, layerId } = AppState.streetsGeo;
      if(map.getSource(sourceId)){
        map.getSource(sourceId).setData(fc);
      } else {
        map.addSource(sourceId,{ type:'geojson', data:fc });
        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-width': 3,
            'line-color': [
              'match',['get','dangerLevel'],
              2,'red',
              1,'yellow',
            ]
          }
        });
      }
    })
    .catch(e=>console.error('GeoJSON Road Error',e));
}

function clearGeoJSONStreets() {
  const { sourceId, layerId } = AppState.streetsGeo;
  if(map.getLayer(layerId)) map.removeLayer(layerId);
  if(map.getSource(sourceId)) map.removeSource(sourceId);
}

// 7. Clear-Funktionen
function clearHeatmap() {
  const { sourceId, layerId } = AppState.heat;
  if(map.getLayer(layerId)) map.removeLayer(layerId);
  if(map.getSource(sourceId)) map.removeSource(sourceId);
}
function clearCompositeStreets() {
  if(map.getLayer('road-danger')) map.removeLayer('road-danger');
  disableCompositeStreetMode();
}
function clearGeoStreets() {
  clearGeoJSONStreets();
}

// 8. Marker-Klasse + Socket.IO
class MapEvent {
  constructor(data) {
    this.title = data.type;
    this.date = new Date(data.date);
    this.location = data.location;
    this.description = data.description;
    this.coordinates = [data.lng, data.lat];
    this.marker = null;
  }
  addToMap() {
    const el = document.createElement('div');
    el.className = 'map-marker';
    el.style.backgroundColor = computeColorByAge(this.date);
    el.style.opacity = computeOpacityByAge(this.date);
    el.style.width = '15px';
    el.style.height = '15px';
    el.style.borderRadius = '50%';
    el.type = this.title;
    this.marker = new mapboxgl.Marker(el).setLngLat(this.coordinates).addTo(map);
    el.addEventListener('click', ()=> showEventDetails(this));
    addLatestEvent(
      this.title,
      this.date.toISOString().split('T')[0],
      this.location,
      this.coordinates[1], this.coordinates[0],
      this.description
    );
    AppState.markers.push(this.marker);
  }
}

// 9. Map-Instanz erstellen
const map = new mapboxgl.Map({
  container: 'map',
  style: AppState.themes[AppState.currentTheme].url,
  center: [9.990682, 53.564086],
  zoom: 10.5
});
addControls(map);

// apply mode initial und nach Theme-Wechsel
map.on('load', applyCurrentMode);
map.on('style.load', applyCurrentMode);

// Socket.IO
const socket = io();
socket.on('EventCreated', data => new MapEvent(data).addToMap());

// 10. Apply Mode
function applyCurrentMode() {
  const mode = AppState.modes[AppState.currentMode];

  // remove all existing
  AppState.markers.forEach(m=>m.remove());
  clearHeatmap();
  clearCompositeStreets();
  clearGeoStreets();

  if(mode === 'Punkte') {
    AppState.markers.forEach(m=>m.addTo(map));
  } else if(mode === 'Heatmap') {
    loadHeatmapData();
  } else if(mode === 'Straßenmodus') {
    // if Standard theme or no composite source, use GeoJSON fallback
    if(AppState.currentTheme === 0 || !map.getSource('composite')) {
      loadGeoJSONStreetData();
    } else {
      enableCompositeStreetMode();
    }
  }

  document.getElementById('mode-toggle').innerHTML = `<h3>${mode}</h3>`;
}

// 11. Switch Helper
function switchTo(indexKey, arrayKey, onChange) {
  AppState[indexKey] = (AppState[indexKey]+1)%AppState[arrayKey].length;
  onChange(AppState[indexKey]);
}

// 12. Modus- und Theme-Wechsel-Funktionen
function toggleModeChange() {
  switchTo('currentMode','modes', applyCurrentMode);
}
function toggleTheme() {
  switchTo('currentTheme','themes', idx=>{
    map.setStyle(AppState.themes[idx].url);
    document.getElementById('theme-toggle').innerHTML =
      `<h3>${AppState.themes[idx].name}</h3>`;
  });
}

// 13. Sidebar & Filter (unverändert)
function showEventDetails(event) {
  const sidebar = document.getElementById('sidebar');
  const content = document.getElementById('event-content');
  const [lng,lat] = event.coordinates;
  content.innerHTML = `
    <h2>${event.title}</h2>
    <p><strong>Date:</strong> ${event.date.toLocaleString()}</p>
    <p><strong>Location:</strong> ${event.location}</p>
    <p><strong>Coordinates:</strong> ${lat}, ${lng}</p>
    <p>${event.description}</p>
  `;
  sidebar?.classList.add('active');
}
function updateFilter(cb) {
  document.querySelectorAll('.map-marker').forEach(el=>{
    if(el.type===cb.value) el.style.display = cb.checked?'block':'none';
  });
}
function toggleFiltersMenu(){document.getElementById('filters-menu').classList.toggle('active');}
function toggleLegendMenu(){document.getElementById('legend-menu').classList.toggle('active');}
function addLatestEvent(t,d,l,lat,lng,desc){
  const ct=document.getElementById('latest-events-content'); if(!ct)return;
  if(ct.children.length>=50) ct.removeChild(ct.firstChild);
  const e=document.createElement('div'); e.className='latest-event';
  e.innerHTML = `
    <h3>${t}</h3>
    <p><strong>Date:</strong> ${d}</p>
    <p><strong>Location:</strong> ${l}</p>
    <p><strong>Coordinates:</strong> ${lat}, ${lng}</p>
    <p>${desc}</p>
  `;
  ct.appendChild(e);
}
function toggleLatestEventsSidebar(){document.getElementById('latest-events-sidebar').classList.toggle('active');}
function toggleSidebar(){document.getElementById('sidebar').classList.toggle('active');}
function flyToDistrict(){UI.flyToDistrict(document.getElementById('district-select').value);}
