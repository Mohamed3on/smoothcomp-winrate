import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Filters } from '@/lib/filters';

// One place on the map: a dot of its size, brighter when `read`, whose popup names it (a link: on this
// site when `internal`, else out) and says `about` it.
export interface Dot { lat: number; lng: number; radius: number; read: boolean; title: string; href: string; internal: boolean; about: string }

// Events or academies on a map (Mapbox's dark tiles, through the site's own /tiles), around the chosen place
// when there is one, the distance as a ring. Loaded only when a map is opened.
export default function PlacesMap({ dots, f }: { dots: Dot[]; f: Filters }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [, navigate] = useLocation();
  useEffect(() => {
    const m = L.map(box.current!, { worldCopyJump: true });
    L.tileLayer('/tiles/{z}/{x}/{y}', { maxZoom: 18, attribution: '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(m);
    m.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    return () => { m.remove(); };
  }, []);
  const near = f.get('near'), km = Number(f.get('km')) || 0;
  useEffect(() => {
    const m = map.current!, group = layer.current!;
    group.clearLayers();
    // Names go in as text, never as markup.
    const popup = (d: Dot) => {
      const card = document.createElement('div');
      const title = document.createElement('a');
      title.textContent = d.title;
      title.className = 'event-title';
      title.href = d.href;
      if (d.internal) title.onclick = (click) => { click.preventDefault(); navigate(d.href); };
      else title.rel = 'noopener';
      const about = document.createElement('div');
      about.textContent = d.about;
      card.append(title, about);
      return card;
    };
    for (const d of dots) L.circleMarker([d.lat, d.lng], { radius: d.radius, className: d.read ? 'event-dot read' : 'event-dot' }).bindPopup(() => popup(d)).addTo(group);
    const [lat, lng] = near.split(',').map(Number);
    if (near && Number.isFinite(lat) && Number.isFinite(lng)) {
      L.circleMarker([lat, lng], { radius: 4, className: 'event-here', interactive: false }).addTo(group);
      // The ring's box from its centre and radius: a circle can't measure itself before the map has a view.
      if (km) { L.circle([lat, lng], { radius: km * 1000, className: 'event-area', interactive: false }).addTo(group); m.fitBounds(L.latLng(lat, lng).toBounds(km * 2000), { padding: [12, 12] }); }
      else m.setView([lat, lng], 5);
    } else if (dots.length) m.fitBounds(L.latLngBounds(dots.map((d) => [d.lat, d.lng])), { padding: [24, 24], maxZoom: 9 });
    else m.setView([30, 10], 2);
  }, [dots, near, km]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={box} className="places-map h-[70svh] min-h-80 w-full overflow-hidden rounded-xl border" />;
}
