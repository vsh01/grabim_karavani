// Сохранения в localStorage: три обычных слота плюс автосохранение.

const PREFIX = 'grabim_korovany.save.';
export const SAVE_VERSION = 1;
export const SLOTS = ['auto', '1', '2', '3'];

const key = (slot) => `${PREFIX}${slot}`;

export function saveGame(slot, payload) {
  const record = {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    data: payload,
  };
  try {
    localStorage.setItem(key(slot), JSON.stringify(record));
    return { ok: true };
  } catch (err) {
    // Чаще всего это переполнение квоты localStorage.
    return { ok: false, error: String(err) };
  }
}

export function loadGame(slot) {
  try {
    const raw = localStorage.getItem(key(slot));
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (record.version !== SAVE_VERSION) return null;
    return record;
  } catch {
    return null;
  }
}

export function deleteSave(slot) {
  try {
    localStorage.removeItem(key(slot));
  } catch {
    /* хранилище недоступно — молча пропускаем */
  }
}

/** Краткая сводка по каждому слоту для меню загрузки. */
export function listSaves() {
  return SLOTS.map((slot) => {
    const record = loadGame(slot);
    if (!record) return { slot, empty: true };
    const d = record.data || {};
    return {
      slot,
      empty: false,
      savedAt: record.savedAt,
      faction: d.faction,
      level: d.player?.level ?? 1,
      gold: d.player?.gold ?? 0,
      zone: d.zoneName || '—',
      playtime: d.playtime || 0,
    };
  });
}

export function hasAnySave() {
  return listSaves().some((s) => !s.empty);
}

export function formatSaveDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
