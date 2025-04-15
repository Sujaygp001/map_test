import React, { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import * as turf from "@turf/turf";
import "@fortawesome/fontawesome-free/css/all.min.css";

import "./MapView.css";

mapboxgl.accessToken = 'pk.eyJ1Ijoic3VqYXlncDAwMSIsImEiOiJjbTlpNHZrZ24wZTZnMmtzYzczcDg5bmN4In0.uw-neid2XXgwS8HZjKf1Qg';

function MapView() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markerMap = useRef({});

  const emojiMap = {
    CORPORATE: "🎯",
    PRACTICE: "🏥",
    EHR: "💻",
    INSURANCE: "🛡",
    ANCILLIARY: "🧑‍⚕️"
  };
  const iconMap = {
    CORPORATE: "fa-building",
    PRACTICE: "fa-hospital",
    EHR: "fa-desktop",
    INSURANCE: "fa-shield-alt",
    ANCILLIARY: "fa-user-nurse"
  };
  

  useEffect(() => {
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/light-v10",
      center: [-98, 39],
      zoom: 3
    });

    map.current.on("load", async () => {
      await loadLayerFromUrl("msa", "/data/msa.geojson", "#9b59b6", 0.3, "NAME");
      await loadLayerFromUrl("county", "/data/counties.geojson", "#3498db", 0.3, "NAME");
      await loadLayerFromUrl("zip", "/data/Zip_Codes.geojson", "#e74c3c", 0.4, "ZIP_CODE_TEXT");

      map.current.on("zoom", () => {
        const zoom = map.current.getZoom();
        toggleVisibility("msa", zoom < 6);
        toggleVisibility("county", zoom >= 6 && zoom < 10);
        toggleVisibility("zip", zoom >= 10);
      });

      await plotEntityPins();
      await zoomToMSA();
    });
  }, []);

  const handleSearch = async () => {
    const input = document.getElementById("search-input").value.trim();
    if (!input) return;
  
    const query = encodeURIComponent(`${input}, USA`);
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${mapboxgl.accessToken}`
    );
    const data = await res.json();
    const feature = data.features[0];
  
    if (!feature) {
      alert("Location not found.");
      return;
    }
  
    const coords = feature.center;
    const placeType = feature.place_type?.[0]; // could be "postcode", "place", "address", etc.
  
    let zoomLevel = 10; // default
    if (placeType === "postcode") {
      zoomLevel = 14; // more zoom for ZIP
    }
  
    map.current.flyTo({ center: coords, zoom: zoomLevel });
  };
  

  const zoomToMSA = async () => {
    const msaRes = await fetch("/data/msa.geojson");
    const msaData = await msaRes.json();

    if (msaData.features.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      msaData.features.forEach(feature => {
        const coords = feature.geometry.coordinates;
        if (feature.geometry.type === "Polygon") {
          coords[0].forEach(c => bounds.extend(c));
        } else if (feature.geometry.type === "MultiPolygon") {
          coords.forEach(polygon => polygon[0].forEach(c => bounds.extend(c)));
        }
      });
      map.current.fitBounds(bounds, { padding: 40 });
    }
  };

  const loadLayerFromUrl = async (id, url, color, opacity, labelField) => {
    const res = await fetch(url);
    const data = await res.json();
    await loadLayer(id, data, color, opacity, labelField);
  };

  const loadLayer = async (id, data, color, opacity, labelField) => {
    if (map.current.getSource(id)) return;

    map.current.addSource(id, { type: "geojson", data });

    map.current.addLayer({
      id: `${id}-fill`,
      type: "fill",
      source: id,
      paint: {
        "fill-color": color,
        "fill-opacity": opacity
      },
      layout: { visibility: "none" }
    });

    map.current.addLayer({
      id: `${id}-outline`,
      type: "line",
      source: id,
      paint: {
        "line-color": "#000",
        "line-width": 1
      },
      layout: { visibility: "none" }
    });

    map.current.addLayer({
      id: `${id}-label`,
      type: "symbol",
      source: id,
      layout: {
        "text-field": ["get", labelField],
        "text-font": ["Open Sans Bold"],
        "text-size": 12,
        visibility: "none"
      },
      paint: {
        "text-color": "#000",
        "text-halo-color": "#fff",
        "text-halo-width": 1
      }
    });
  };

  const toggleVisibility = (id, visible) => {
    const value = visible ? "visible" : "none";
    map.current.setLayoutProperty(`${id}-fill`, "visibility", value);
    map.current.setLayoutProperty(`${id}-outline`, "visibility", value);
    map.current.setLayoutProperty(`${id}-label`, "visibility", value);
  };

  const getCoordinates = async (address) => {
    const query = encodeURIComponent(address);
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${mapboxgl.accessToken}`
    );
    const data = await res.json();
    const coords = data.features[0]?.center || null;
    if (!coords) {
      console.warn("❌ Geocode failed:", address);
    } else {
      console.log("📍 Geocoded:", address, coords);
    }
    return coords;
  };

  const plotEntityPins = async () => {
    const res = await fetch("/data/sample_entities_dc.json");
    const entities = await res.json();

    for (const entity of entities) {
      const fullAddress = `${entity.streetAddress}, Washington, DC ${entity.zipcode}`;
      const coords = await getCoordinates(fullAddress);
      if (!coords) continue;

      markerMap.current[entity.id] = coords;

      const el = document.createElement("div");
      el.className = `fa-marker fas ${iconMap[entity.entityType]}`;
      
      el.innerHTML = emojiMap[entity.entityType] || "📍";
      el.title = `${entity.name} (${entity.entityType})`;

      new mapboxgl.Marker(el)
        .setLngLat(coords)
        .setPopup(new mapboxgl.Popup().setText(entity.name))
        .addTo(map.current);

      for (const assoc of entity.e_AssociatedEntitys || []) {
        const assocId = assoc.id;
        const assocEntity = entities.find(e => e.id === assocId);
        if (!assocEntity) continue;

        let assocCoords = markerMap.current[assocId];

        if (!assocCoords) {
          const assocAddress = `${assocEntity.streetAddress}, Washington, DC ${assocEntity.zipcode}`;
          assocCoords = await getCoordinates(assocAddress);
          if (!assocCoords) continue;

          markerMap.current[assocId] = assocCoords;

          const assocEl = document.createElement("div");
          assocEl.className = "emoji-marker";
          assocEl.innerHTML = emojiMap[assocEntity.entityType] || "📍";
          assocEl.title = `${assocEntity.name} (${assocEntity.entityType})`;

          new mapboxgl.Marker(assocEl)
            .setLngLat(assocCoords)
            .setPopup(new mapboxgl.Popup().setText(assocEntity.name))
            .addTo(map.current);
        }

        const line = turf.lineString([coords, assocCoords]);
        const curved = turf.bezierSpline(line, { sharpness: 0.85 });

        const sourceId = `line-${entity.id}-${assocId}`;
        if (!map.current.getSource(sourceId)) {
          map.current.addSource(sourceId, { type: "geojson", data: curved });
          map.current.addLayer({
            id: sourceId,
            type: "line",
            source: sourceId,
            layout: {
              "line-cap": "round",
              "line-join": "round"
            },
            paint: {
              "line-color": "#111",
              "line-width": 4,
              "line-opacity": 0.85,
              "line-dasharray": [1, 2]
            }
          });
        }
      }
    }
  };

  return (
    <>
      <div className="search-container">
        <input type="text" id="search-input" placeholder="Search ZIP, County or Address..." />
        <button onClick={handleSearch}>Search</button>
      </div>
      <div ref={mapContainer} className="map-container" />
    </>
  );
}

export default MapView;
