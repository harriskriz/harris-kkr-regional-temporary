export interface LevelColors {
  background: string;
  border: string;
}

/** Pin colors per school level; anything else falls back to OTHER_LEVEL_COLORS. */
const LEVEL_COLORS: Record<string, LevelColors> = {
  SD: { background: '#d1242f', border: '#82071e' },
  SMP: { background: '#0969da', border: '#0a3069' },
  SMA: { background: '#1a7f37', border: '#044f1e' },
  SMK: { background: '#1a7f37', border: '#044f1e' },
};
const OTHER_LEVEL_COLORS: LevelColors = { background: '#6e7781', border: '#424a53' };

export function levelColors(level: string | null): LevelColors {
  return LEVEL_COLORS[level?.trim().toUpperCase() ?? ''] ?? OTHER_LEVEL_COLORS;
}

/** Natural, case-insensitive order: 'SD GMIT 02' before 'SD GMIT 023', 'SMA NEGERI' before 'SMAN'. */
export const byName = new Intl.Collator('id', { numeric: true, sensitivity: 'base' }).compare;
