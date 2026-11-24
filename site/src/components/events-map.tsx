import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { EventRow } from '@/lib/api';
import type { Filters } from '@/lib/filters';
import { date, fmt } from '@/lib/format';

// The events on a map (Mapbox's dark tiles, through the site's own /tiles), around the chosen place when
// there is one: a dot each, brighter once someone has read its entrants, and the distance as a ring. A dot's
// popup gives the date, place and size, and links where its row would. Loaded only when the map is opened.
export default function EventsMap({ rows, f }: { rows: EventRow[]; f: Filters }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const dots = useRef<L.LayerGroup | null>(null);
  const [, navigate] = useLocation();
  useEffect(() => {
    const m = L.map(box.current!, { worldCopyJump: true });
    L.tileLayer('/tiles/{z}/{x}/{y}', { maxZoom: 18, attribution: '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(m);
    m.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    map.current = m;
    dots.current = L.layerGroup().addTo(m);
    return () => { m.remove(); };
  }, []);
  const near = f.get('near'), km = Number(f.get('km')) || 0;
  useEffect(() => {
    const m = map.current!, layer = dots.current!;
    layer.clearLayers();
    // Text from the events goes in as text, never as markup.
    const popup = (e: EventRow) => {
      const card = document.createElement('div');
      const title = document.createElement('a');
      title.textContent = e.title ?? `Event ${e.event}`;
      title.className = 'event-title';
      if (e.athletes) {
        title.href = f.link(`/event/${e.event}`);
        title.onclick = (click) => { click.preventDefault(); navigate(title.getAttribute('href')!); };
      } else {
        title.href = e.url ?? `${f.home}/en/event/${e.event}`;
        title.rel = 'noopener';
      }
      const about = document.createElement('div');
      about.textContent = [date(e.start), e.city, e.km != null && `${fmt(Math.round(e.km))} km`, e.athletes ? `${fmt(e.athletes)} athletes` : 'Entrants not read yet'].filter(Boolean).join(' · ');
      card.append(title, about);
      return card;
    };
    const placed = rows.filter((e) => e.lat != null && e.lng != null);
    for (const e of placed) L.circleMarker([e.lat!, e.lng!], { radius: e.athletes ? 7 : 5, className: e.athletes ? 'event-dot read' : 'event-dot' }).bindPopup(() => popup(e)).addTo(layer);
    const [lat, lng] = near.split(',').map(Number);
    if (near && Number.isFinite(lat) && Number.isFinite(lng)) {
      L.circleMarker([lat, lng], { radius: 4, className: 'event-here', interactive: false }).addTo(layer);
      // The ring's box from its centre and radius: a circle can't measure itself before the map has a view.
      if (km) { L.circle([lat, lng], { radius: km * 1000, className: 'event-area', interactive: false }).addTo(layer); m.fitBounds(L.latLng(lat, lng).toBounds(km * 2000), { padding: [12, 12] }); }
      else m.setView([lat, lng], 5);
    } else if (placed.length) m.fitBounds(L.latLngBounds(placed.map((e) => [e.lat!, e.lng!])), { padding: [24, 24], maxZoom: 9 });
    else m.setView([30, 10], 2);
  }, [rows, near, km]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={box} className="events-map h-[70svh] min-h-80 w-full overflow-hidden rounded-xl border" />;
}
