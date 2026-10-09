import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface School {
  id: number;
  name: string;
  district: string;
  level: string | null;
  latitude: number | null;
  longitude: number | null;
}

export type LocatedSchool = School & { latitude: number; longitude: number };

/** Some schools have no known coordinates yet; those are listed but not pinned. */
export function hasCoordinates(school: School): school is LocatedSchool {
  return school.latitude != null && school.longitude != null;
}

@Injectable({ providedIn: 'root' })
export class SchoolService {
  private readonly http = inject(HttpClient);

  getConfig(): Observable<{ googleMapsApiKey: string }> {
    return this.http.get<{ googleMapsApiKey: string }>('/api/config');
  }

  getDistricts(): Observable<string[]> {
    return this.http.get<string[]>('/api/districts');
  }

  getSchools(district: string): Observable<School[]> {
    return this.http.get<School[]>('/api/schools', { params: new HttpParams().set('district', district) });
  }
}
