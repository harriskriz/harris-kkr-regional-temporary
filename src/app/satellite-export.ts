import { levelColors } from './school-levels';
import { LocatedSchool, School, hasCoordinates } from './school.service';

/*
 * Builds two images per district: a large satellite map stitched from Google
 * Static Maps images with the school pins, names and a scale bar, and a separate
 * list of every school with its coordinates. "Logical" pixels are Web Mercator pixels at the
 * chosen zoom; the output image has SCALE output pixels per logical pixel.
 */

const TILE = 640; // logical px per Static Maps request (the API maximum)
const SCALE = 2; // Static Maps `scale=2`: 1280×1280 output px per request
const CROP_BOTTOM = 30; // logical px dropped from each request to hide the Google logo strip
const STEP_Y = TILE - CROP_BOTTOM;
const PAD = 120; // logical px of margin around the outermost schools, room for labels

const MAX_ZOOM = 17;
const MIN_ZOOM = 10;
const MAX_MAP_SIDE = 13000; // output px; keeps the canvas buildable and the file openable on phones
const MAX_MAP_AREA = 130_000_000;

const LIST_WIDTH = 1400;
const LIST_HEADER = 280;
const LIST_ROW = 72;

const FETCH_CONCURRENCY = 6;

export interface ExportPlan {
  zoom: number;
  /** Top-left of the stitched area, in logical px at `zoom`. */
  originX: number;
  originY: number;
  cols: number;
  rows: number;
  /** Output px of the satellite image. */
  mapWidth: number;
  mapHeight: number;
}

export interface ExportProgress {
  done: number;
  total: number;
}

export function planExport(schools: School[]): ExportPlan | null {
  const located = schools.filter(hasCoordinates);
  if (!located.length) return null;

  for (let zoom = MAX_ZOOM; zoom >= MIN_ZOOM; zoom--) {
    const points = located.map((s) => project(s.latitude, s.longitude, zoom));
    const minX = Math.min(...points.map((p) => p.x)) - PAD;
    const maxX = Math.max(...points.map((p) => p.x)) + PAD;
    const minY = Math.min(...points.map((p) => p.y)) - PAD;
    const maxY = Math.max(...points.map((p) => p.y)) + PAD;

    const cols = Math.ceil((maxX - minX) / TILE);
    const rows = Math.ceil((maxY - minY) / STEP_Y);
    const mapWidth = cols * TILE * SCALE;
    const mapHeight = rows * STEP_Y * SCALE;
    if (Math.max(mapWidth, mapHeight) > MAX_MAP_SIDE || mapWidth * mapHeight > MAX_MAP_AREA) continue;

    // Centre the schools inside the (slightly larger) tile grid.
    const originX = Math.round(minX - (cols * TILE - (maxX - minX)) / 2);
    const originY = Math.round(minY - (rows * STEP_Y - (maxY - minY)) / 2);
    return { zoom, originX, originY, cols, rows, mapWidth, mapHeight };
  }
  return null;
}

export interface ExportImages {
  map: Blob;
  list: Blob;
}

export async function renderExport(
  plan: ExportPlan,
  district: string,
  schools: School[],
  apiKey: string,
  onProgress: (progress: ExportProgress) => void,
): Promise<ExportImages> {
  const canvas = createCanvas(plan.mapWidth, plan.mapHeight);
  const ctx = canvas.getContext('2d')!;
  const failed = await drawImagery(ctx, plan, apiKey, onProgress);
  const located = schools.filter(hasCoordinates);
  drawPinsAndLabels(ctx, plan, located);
  drawScaleBar(ctx, plan, located);
  const map = await toBlob(canvas, 'image/jpeg');

  const listCanvas = createCanvas(LIST_WIDTH, LIST_HEADER + schools.length * LIST_ROW + 48);
  drawSchoolList(listCanvas.getContext('2d')!, district, schools, failed);
  const list = await toBlob(listCanvas, 'image/png');

  return { map, list };
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot create an image this large.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

async function toBlob(canvas: HTMLCanvasElement, type: 'image/jpeg' | 'image/png'): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  // Release the (possibly very large) backing store right away.
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error('The browser could not encode the image. Try a smaller district.');
  return blob;
}

// ---------------------------------------------------------------- imagery

async function drawImagery(
  ctx: CanvasRenderingContext2D,
  plan: ExportPlan,
  apiKey: string,
  onProgress: (progress: ExportProgress) => void,
): Promise<number> {
  const jobs: { col: number; row: number }[] = [];
  for (let row = 0; row < plan.rows; row++) {
    for (let col = 0; col < plan.cols; col++) jobs.push({ col, row });
  }

  let done = 0;
  let failed = 0;
  onProgress({ done, total: jobs.length });

  const worker = async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const dx = job.col * TILE * SCALE;
      const dy = job.row * STEP_Y * SCALE;
      const center = unproject(
        plan.originX + job.col * TILE + TILE / 2,
        plan.originY + job.row * STEP_Y + TILE / 2,
        plan.zoom,
      );
      try {
        const image = await fetchTile(center.lat, center.lng, plan.zoom, apiKey);
        ctx.drawImage(image, 0, 0, TILE * SCALE, STEP_Y * SCALE, dx, dy, TILE * SCALE, STEP_Y * SCALE);
        image.close();
      } catch {
        failed++;
        ctx.fillStyle = '#d0d7de';
        ctx.fillRect(dx, dy, TILE * SCALE, STEP_Y * SCALE);
      }
      onProgress({ done: ++done, total: plan.cols * plan.rows });
    }
  };
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
  return failed;
}

async function fetchTile(lat: number, lng: number, zoom: number, apiKey: string): Promise<ImageBitmap> {
  const url =
    'https://maps.googleapis.com/maps/api/staticmap' +
    `?center=${lat.toFixed(7)},${lng.toFixed(7)}&zoom=${zoom}` +
    `&size=${TILE}x${TILE}&scale=${SCALE}&maptype=satellite&format=jpg` +
    `&key=${encodeURIComponent(apiKey)}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Static Maps returned ${response.status}`);
      return await createImageBitmap(await response.blob());
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
}

// ---------------------------------------------------------------- pins & labels

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PIN_RADIUS = 22;
const PIN_HEIGHT = 62; // from the tip to the top of the head
const LABEL_FONT = 'bold 26px "Segoe UI", Roboto, Arial, sans-serif';
const LABEL_PAD_X = 8;
const LABEL_HEIGHT = 38;

function drawPinsAndLabels(ctx: CanvasRenderingContext2D, plan: ExportPlan, schools: LocatedSchool[]): void {
  const placed = schools.map((school) => {
    const p = project(school.latitude, school.longitude, plan.zoom);
    return { school, x: (p.x - plan.originX) * SCALE, y: (p.y - plan.originY) * SCALE };
  });

  // Pins first (north to south so lower pins overlap upper ones naturally)...
  placed.sort((a, b) => a.y - b.y);
  const obstacles: Rect[] = placed.map(({ x, y }) => ({
    x: x - PIN_RADIUS,
    y: y - PIN_HEIGHT,
    w: PIN_RADIUS * 2,
    h: PIN_HEIGHT,
  }));
  for (const { school, x, y } of placed) drawPin(ctx, x, y, school);

  // ...then labels, each in the first spot that does not cover a pin or another label.
  ctx.font = LABEL_FONT;
  for (const { school, x, y } of placed) {
    const w = ctx.measureText(school.name).width + LABEL_PAD_X * 2;
    const headY = y - PIN_HEIGHT + PIN_RADIUS;
    const candidates: Rect[] = [
      { x: x + PIN_RADIUS + 6, y: headY - LABEL_HEIGHT / 2, w, h: LABEL_HEIGHT }, // right
      { x: x - PIN_RADIUS - 6 - w, y: headY - LABEL_HEIGHT / 2, w, h: LABEL_HEIGHT }, // left
      { x: x - w / 2, y: y - PIN_HEIGHT - 6 - LABEL_HEIGHT, w, h: LABEL_HEIGHT }, // above
      { x: x - w / 2, y: y + 6, w, h: LABEL_HEIGHT }, // below
    ];
    const rect = candidates.find((c) => !obstacles.some((o) => intersects(c, o))) ?? candidates[0];
    obstacles.push(rect);
    drawLabel(ctx, rect, school.name);
  }
}

function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, school: School): void {
  const colors = levelColors(school.level);
  const r = PIN_RADIUS;
  const cy = y - PIN_HEIGHT + r;

  ctx.save();
  ctx.shadowColor = 'rgb(0 0 0 / 45%)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x - r * 0.35, cy + r * 1.3, x - r, cy + r * 0.75, x - r, cy);
  ctx.arc(x, cy, r, Math.PI, 0);
  ctx.bezierCurveTo(x + r, cy + r * 0.75, x + r * 0.35, cy + r * 1.3, x, y);
  ctx.closePath();
  ctx.fillStyle = colors.background;
  ctx.fill();
  ctx.restore();

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = colors.border;
  ctx.stroke();

  const id = String(school.id);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${id.length > 2 ? 18 : 21}px "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(id, x, cy + 1);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

function drawLabel(ctx: CanvasRenderingContext2D, rect: Rect, text: string): void {
  ctx.fillStyle = 'rgb(0 0 0 / 68%)';
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 6);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = LABEL_FONT;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, rect.x + LABEL_PAD_X, rect.y + rect.h / 2 + 1);
  ctx.textBaseline = 'alphabetic';
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// ---------------------------------------------------------------- scale bar & attribution

function drawScaleBar(ctx: CanvasRenderingContext2D, plan: ExportPlan, schools: LocatedSchool[]): void {
  const lat = schools.reduce((sum, s) => sum + s.latitude, 0) / schools.length;
  const metersPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** plan.zoom / SCALE;
  const target = metersPerPx * 400; // aim for a bar about 400 px long
  const meters = [50, 100, 200, 500, 1000, 2000, 5000, 10000].find((m) => m >= target) ?? 10000;
  const barWidth = meters / metersPerPx;
  const label = meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;

  const x = 40;
  const y = plan.mapHeight - 60;
  ctx.fillStyle = 'rgb(255 255 255 / 85%)';
  ctx.beginPath();
  ctx.roundRect(x - 16, y - 54, Math.max(barWidth, 420) + 32, 92, 8);
  ctx.fill();

  ctx.fillStyle = '#1f2328';
  ctx.fillRect(x, y, barWidth, 10);
  ctx.fillRect(x, y - 14, 4, 24);
  ctx.fillRect(x + barWidth - 4, y - 14, 4, 24);
  ctx.font = 'bold 26px "Segoe UI", Roboto, Arial, sans-serif';
  ctx.fillText(label, x, y - 22);
  ctx.font = '20px "Segoe UI", Roboto, Arial, sans-serif';
  ctx.fillText(`Imagery © ${new Date().getFullYear()} Google`, x, y + 32);
}

// ---------------------------------------------------------------- school list

function drawSchoolList(
  ctx: CanvasRenderingContext2D,
  district: string,
  schools: School[],
  failedTiles: number,
): void {
  const x0 = 48;
  const font = (size: number, weight = 'normal') => `${weight} ${size}px "Segoe UI", Roboto, Arial, sans-serif`;

  ctx.fillStyle = '#1f2328';
  ctx.font = font(56, 'bold');
  ctx.fillText(district, x0, 96);
  ctx.font = font(28);
  ctx.fillStyle = '#59636e';
  const located = schools.filter(hasCoordinates).length;
  ctx.fillText(
    `${schools.length} schools · ${located} on the map · exported ${new Date().toLocaleDateString('id-ID')}`,
    x0,
    146,
  );
  if (failedTiles) {
    ctx.fillStyle = '#d1242f';
    ctx.fillText(`${failedTiles} imagery tile(s) failed to download and are grey on the map.`, x0, 186);
  }

  // Legend
  let lx = x0;
  for (const [level, text] of [
    ['SD', 'SD'],
    ['SMP', 'SMP'],
    ['SMA', 'SMA / SMK'],
  ] as const) {
    ctx.fillStyle = levelColors(level).background;
    ctx.beginPath();
    ctx.arc(lx + 12, 226, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1f2328';
    ctx.font = font(26);
    ctx.fillText(text, lx + 32, 235);
    lx += 64 + ctx.measureText(text).width;
  }

  schools.forEach((school, i) => {
    const x = x0;
    const y = LIST_HEADER + i * LIST_ROW;
    const colors = levelColors(school.level);
    const hasCoords = hasCoordinates(school);

    if (!hasCoords) {
      ctx.fillStyle = '#ffebe9';
      ctx.fillRect(x - 12, y - 4, LIST_WIDTH - 72, LIST_ROW - 6);
    }
    ctx.fillStyle = hasCoords ? colors.background : '#8c959f';
    ctx.beginPath();
    ctx.roundRect(x, y + 6, 72, 34, 6);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = font(22, 'bold');
    ctx.textAlign = 'center';
    ctx.fillText(String(school.id), x + 36, y + 31);
    ctx.textAlign = 'start';

    ctx.fillStyle = '#1f2328';
    ctx.font = font(26, 'bold');
    ctx.fillText(school.name, x + 88, y + 30);
    ctx.fillStyle = hasCoords ? '#59636e' : '#a40e26';
    ctx.font = font(22);
    const coords = hasCoords
      ? `${school.latitude.toFixed(6)}, ${school.longitude.toFixed(6)}`
      : 'No coordinates (not on the map)';
    ctx.fillText([school.level, coords].filter(Boolean).join(' · '), x + 88, y + 58);
  });
}

// ---------------------------------------------------------------- Web Mercator

function project(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const worldSize = 256 * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * worldSize,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * worldSize,
  };
}

function unproject(x: number, y: number, zoom: number): { lat: number; lng: number } {
  const worldSize = 256 * 2 ** zoom;
  return {
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / worldSize))) * 180) / Math.PI,
    lng: (x / worldSize) * 360 - 180,
  };
}
