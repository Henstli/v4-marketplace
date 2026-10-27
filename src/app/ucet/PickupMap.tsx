'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import styles from './delivery.module.css';

// Výchozí pohled na Česko a Slovensko, když prodejce ještě nic nevybral.
const DEFAULT: [number, number] = [49.6, 16.6];

/** Mapa OpenStreetMap: klik nebo přetažení špendlíku nastaví místo předání, kroužek ukazuje okruh. */
export function PickupMap({ lat, lng, radiusKm, onPick }: { lat: number | null; lng: number | null; radiusKm: number; onPick: (lat: number, lng: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const api = useRef<{ setRadius: (km: number) => void; moveTo: (lat: number, lng: number) => void } | null>(null);
  // Poslední bod, který mapa sama nahlásila (klik, přetažení), ať ho zvenku neposouvá znovu.
  const last = useRef<string | null>(lat != null && lng != null ? `${lat},${lng}` : null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    let map: import('leaflet').Map | null = null;
    let cancelled = false;
    (async () => {
      const L = await import('leaflet');
      if (cancelled || !box.current) return;
      const start: [number, number] = lat != null && lng != null ? [lat, lng] : DEFAULT;
      map = L.map(box.current, { scrollWheelZoom: false }).setView(start, lat != null ? 12 : 6);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      const icon = L.divIcon({ className: styles.pin, html: '<span></span>', iconSize: [24, 32], iconAnchor: [12, 32] });
      const marker = L.marker(start, { draggable: true, icon, opacity: lat != null ? 1 : 0 }).addTo(map);
      const circle = L.circle(start, { radius: radiusKm * 1000, className: styles.radius, weight: 1, fillOpacity: lat != null ? 0.15 : 0, opacity: lat != null ? 0.6 : 0 }).addTo(map);
      const show = (p: import('leaflet').LatLngExpression) => {
        marker.setLatLng(p).setOpacity(1);
        circle.setLatLng(p).setStyle({ opacity: 0.6, fillOpacity: 0.15 });
      };
      const place = (p: import('leaflet').LatLng) => {
        show(p);
        last.current = `${p.lat},${p.lng}`;
        pick.current(p.lat, p.lng);
      };
      map.on('click', (e) => place(e.latlng));
      marker.on('dragend', () => place(marker.getLatLng()));
      api.current = {
        setRadius: (km) => circle.setRadius(km * 1000),
        moveTo: (la, ln) => { show([la, ln]); map?.setView([la, ln], 13); },
      };
    })();
    return () => {
      cancelled = true;
      map?.remove();
      api.current = null;
    };
    // Mapa se vytváří jen jednou, poloha se dál mění klikem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.current?.setRadius(radiusKm);
  }, [radiusKm]);

  // Místo vybrané v našeptávači posune špendlík i mapu.
  useEffect(() => {
    if (lat == null || lng == null || last.current === `${lat},${lng}`) return;
    last.current = `${lat},${lng}`;
    api.current?.moveTo(lat, lng);
  }, [lat, lng]);

  return <div ref={box} className={styles.map} role="application" aria-label="Mapa místa předání: klikněte na místo, kde karty předáváte" />;
}
