/**
 * 収録の前提（fits）と、その場の値（facts）を比べる。DOM にも音にも依存しない。
 * fits の値がすべて場面の値と同じなら合う。場面に無い値は合うとみなす（収録どおりの場面）。
 */
export const fitsScene = (fits: Record<string, number> | undefined, facts: Record<string, number> | undefined): boolean =>
  !fits || Object.entries(fits).every(([k, v]) => facts?.[k] === undefined || facts[k] === v);
