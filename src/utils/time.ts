export const nowIso = (): string => new Date().toISOString();
export const daysUntil = (isoDate: string): number =>
  (new Date(isoDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
