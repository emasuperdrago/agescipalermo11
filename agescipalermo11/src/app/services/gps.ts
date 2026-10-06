import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface GpsPosition {
  latitudine: number;
  longitudine: number;
  accuratezza: number;
}

@Injectable({
  providedIn: 'root'
})
export class GpsService {

  getPosizione(): Promise<GpsPosition> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocalizzazione non supportata dal dispositivo.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            latitudine: pos.coords.latitude,
            longitudine: pos.coords.longitude,
            accuratezza: pos.coords.accuracy
          });
        },
        (err) => {
          reject(new Error(`GPS non disponibile: ${err.message}`));
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    });
  }

  buildGoogleMapsUrl(lat: number, lng: number): string {
    return `https://www.google.com/maps?q=${lat},${lng}`;
  }

  buildPercorsoUrl(checkpoints: { latitudine: number; longitudine: number }[]): string {
    if (checkpoints.length === 0) return '';
    if (checkpoints.length === 1) {
      return this.buildGoogleMapsUrl(checkpoints[0].latitudine, checkpoints[0].longitudine);
    }
    const origin = `${checkpoints[0].latitudine},${checkpoints[0].longitudine}`;
    const destination = `${checkpoints[checkpoints.length - 1].latitudine},${checkpoints[checkpoints.length - 1].longitudine}`;
    const waypoints = checkpoints.slice(1, -1)
      .map(c => `${c.latitudine},${c.longitudine}`)
      .join('|');
    const waypointsParam = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : '';
    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypointsParam}`;
  }

  calcolaDistanzaMetri(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const toRad = (deg: number) => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  isDentroGeofence(
    posizioneAttuale: { latitudine: number; longitudine: number },
    centroFence: { latitudine: number; longitudine: number },
    raggioM: number
  ): boolean {
    const dist = this.calcolaDistanzaMetri(
      centroFence.latitudine, centroFence.longitudine,
      posizioneAttuale.latitudine, posizioneAttuale.longitudine
    );
    return dist <= raggioM;
  }
}
