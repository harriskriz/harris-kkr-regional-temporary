import { Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { loadGoogleMaps } from '../google-maps-loader';
import { ExportProgress, planExport, renderExport } from '../satellite-export';
import { byName, levelColors } from '../school-levels';
import { LocatedSchool, School, SchoolService, hasCoordinates } from '../school.service';

@Component({
  selector: 'app-school-map',
  imports: [DecimalPipe],
  templateUrl: './school-map.html',
  styleUrl: './school-map.css',
  host: { '[class.collapsed]': 'collapsed()' },
})
export class SchoolMap {
  private readonly schoolService = inject(SchoolService);
  private readonly mapElement = viewChild.required<ElementRef<HTMLDivElement>>('map');
  private readonly expandButton = viewChild.required<ElementRef<HTMLButtonElement>>('expandButton');
  private readonly legend = viewChild.required<ElementRef<HTMLElement>>('legend');

  protected readonly districts = signal<string[]>([]);
  protected readonly selectedDistrict = signal<string | null>(null);
  protected readonly schools = signal<School[]>([]);
  protected readonly loadingDistricts = signal(true);
  protected readonly loadingSchools = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly collapsed = signal(false);
  protected readonly schoolQuery = signal('');

  protected readonly filteredSchools = computed(() => {
    const term = this.schoolQuery().trim().toLowerCase();
    if (!term) return this.schools();
    return this.schools().filter(
      (s) => s.name.toLowerCase().includes(term) || s.level?.toLowerCase().includes(term),
    );
  });

  protected readonly exportPlan = computed(() => planExport(this.schools()));
  protected readonly exportProgress = signal<ExportProgress | null>(null);
  protected readonly exportError = signal<string | null>(null);

  private apiKey = '';
  private map?: google.maps.Map;
  private infoWindow?: google.maps.InfoWindow;
  private markers = new Map<number, google.maps.marker.AdvancedMarkerElement>();
  private requestId = 0;

  protected readonly hasCoordinates = hasCoordinates;

  constructor() {
    this.init();
    inject(DestroyRef).onDestroy(() => this.clearMarkers());
  }

  private async init(): Promise<void> {
    try {
      const [config, districts] = await Promise.all([
        firstValueFrom(this.schoolService.getConfig()),
        firstValueFrom(this.schoolService.getDistricts()),
      ]);
      this.districts.set(districts.sort(byName));
      this.loadingDistricts.set(false);

      this.apiKey = config.googleMapsApiKey;
      await loadGoogleMaps(config.googleMapsApiKey);
      this.map = new google.maps.Map(this.mapElement().nativeElement, {
        center: { lat: -8.25, lng: 124.5 }, // Alor Regency
        zoom: 9,
        mapId: 'DEMO_MAP_ID',
        streetViewControl: false,
        // Keeps the top-left corner free for the expand button.
        mapTypeControlOptions: { position: google.maps.ControlPosition.TOP_RIGHT },
      });
      this.infoWindow = new google.maps.InfoWindow();
      // Shown in the map's top-left corner while the sidebar is collapsed.
      this.map.controls[google.maps.ControlPosition.TOP_LEFT].push(this.expandButton().nativeElement);
      this.map.controls[google.maps.ControlPosition.LEFT_BOTTOM].push(this.legend().nativeElement);

      // A district may have been picked while the map script was still loading.
      if (this.selectedDistrict()) this.renderMarkers(this.schools());
    } catch (err) {
      console.error(err);
      this.loadingDistricts.set(false);
      this.error.set('Could not load districts or the map. Is the API server running?');
    }
  }

  protected async selectDistrict(district: string): Promise<void> {
    if (!district || district === this.selectedDistrict()) return;
    const id = ++this.requestId;
    this.selectedDistrict.set(district);
    this.schoolQuery.set('');
    this.exportError.set(null);
    this.loadingSchools.set(true);
    this.error.set(null);
    try {
      const schools = await firstValueFrom(this.schoolService.getSchools(district));
      if (id !== this.requestId) return; // a newer selection superseded this one
      this.schools.set(schools.sort((a, b) => byName(a.name, b.name)));
      this.renderMarkers(schools);
    } catch (err) {
      console.error(err);
      if (id === this.requestId) this.error.set(`Could not load schools for ${district}.`);
    } finally {
      if (id === this.requestId) this.loadingSchools.set(false);
    }
  }

  protected async downloadSatelliteMap(): Promise<void> {
    const plan = this.exportPlan();
    const district = this.selectedDistrict();
    if (!plan || !district || this.exportProgress()) return;
    this.exportError.set(null);
    try {
      const images = await renderExport(plan, district, this.schools(), this.apiKey, (p) => this.exportProgress.set(p));
      const slug = district.trim().replace(/[^\w-]+/g, '-').toLowerCase();
      saveFile(images.map, `satellite-${slug}.jpg`);
      // A short gap keeps browsers from dropping the second of two back-to-back downloads.
      await new Promise((resolve) => setTimeout(resolve, 500));
      saveFile(images.list, `schools-${slug}.png`);
    } catch (err) {
      console.error(err);
      this.exportError.set(err instanceof Error ? err.message : 'Could not create the satellite map.');
    } finally {
      this.exportProgress.set(null);
    }
  }

  protected focusSchool(school: LocatedSchool): void {
    const marker = this.markers.get(school.id);
    if (!this.map || !marker) return;
    this.map.panTo({ lat: school.latitude, lng: school.longitude });
    this.map.setZoom(Math.max(this.map.getZoom() ?? 0, 14));
    this.openInfo(marker, school);
  }

  private renderMarkers(schools: School[]): void {
    if (!this.map) return;
    this.clearMarkers();
    this.infoWindow?.close();

    const located = schools.filter(hasCoordinates);
    const bounds = new google.maps.LatLngBounds();
    for (const school of located) {
      const position = { lat: school.latitude, lng: school.longitude };
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map: this.map,
        position,
        title: `#${school.id} ${school.name}`,
        content: this.createPin(school),
        gmpClickable: true,
      });
      marker.addEventListener('gmp-click', () => this.openInfo(marker, school));
      this.markers.set(school.id, marker);
      bounds.extend(position);
    }

    if (located.length === 1) {
      this.map.setCenter(bounds.getCenter());
      this.map.setZoom(14);
    } else if (located.length > 1) {
      this.map.fitBounds(bounds, 48);
    }
  }

  /** A pin colored by school level, labelled with the school's id. */
  private createPin(school: School): google.maps.marker.PinElement {
    const colors = levelColors(school.level);
    return new google.maps.marker.PinElement({
      background: colors.background,
      borderColor: colors.border,
      glyphText: String(school.id),
      glyphColor: '#ffffff',
      scale: 1.25,
    });
  }

  private openInfo(marker: google.maps.marker.AdvancedMarkerElement, school: LocatedSchool): void {
    const content = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = school.name;
    const meta = document.createElement('div');
    meta.textContent = [school.level, `${school.latitude.toFixed(6)}, ${school.longitude.toFixed(6)}`]
      .filter(Boolean)
      .join(' · ');
    content.append(name, meta);
    this.infoWindow?.setContent(content);
    this.infoWindow?.open({ map: this.map, anchor: marker });
  }

  private clearMarkers(): void {
    for (const marker of this.markers.values()) marker.map = null;
    this.markers.clear();
  }
}

function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
