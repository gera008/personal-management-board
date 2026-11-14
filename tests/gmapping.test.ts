import { describe, expect, it } from 'vitest';
import {
  assignGoogleColors,
  categoryFromGoogle,
  categoryToGoogle,
  nearestGoogleColor,
  notesForGoogle,
  notesFromGoogle,
  reminderFromGoogle,
  reminderToGoogle,
} from '../supabase/functions/_shared/gmapping';

const cats = [
  { id: 'personal', color: '#3D8BFF' },
  { id: 'udem', color: '#FFC93D' },
  { id: 'sap', color: '#22D3EE' },
  { id: 'mios', color: '#A879FF' },
];

describe('nearestGoogleColor', () => {
  it('finds the closest Google color', () => {
    expect(nearestGoogleColor('#FFC93D')).toBe('5'); // yellow -> Banana
    expect(nearestGoogleColor('#22D3EE')).toBe('7'); // cyan -> Peacock
    expect(['1', '3']).toContain(nearestGoogleColor('#A879FF')); // purple -> Lavender/Grape
    expect(nearestGoogleColor('#E11D48')).toBe('11'); // red -> Tomato
    expect(nearestGoogleColor('#9CA3AF')).toBe('8'); // grey -> Graphite
  });
  it('ignores bad input', () => {
    expect(nearestGoogleColor('blue')).toBeNull();
  });
});

describe('assignGoogleColors', () => {
  it('gives every category its own color', () => {
    const m = assignGoogleColors(cats);
    expect(new Set(m.values()).size).toBe(4);
    expect(m.get('sap')).toBe('7'); // cyan keeps Peacock
    expect(['1', '9']).toContain(m.get('personal')); // blue -> Lavender/Blueberry
    expect(m.get('udem')).toBe('5');
  });
  it('shares colors once all 11 are taken', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ id: String(i), color: '#3D8BFF' }));
    expect(assignGoogleColors(many).size).toBe(13);
  });
});

describe('categories', () => {
  it('round-trips a category', () => {
    const g = categoryToGoogle('sap', cats);
    expect(g).toEqual({ colorId: '7', extendedProperties: { private: { miosCategory: 'sap', miosColor: '7' } } });
    expect(categoryFromGoogle({ colorId: '7', categoryProp: 'sap', colorProp: '7' }, cats)).toBe('sap');
  });
  it('keeps the category when the palette shifted but the color was not touched in Google', () => {
    expect(categoryFromGoogle({ colorId: '1', categoryProp: 'sap', colorProp: '1' }, cats)).toBe('sap');
  });
  it('no category clears color and the hidden key', () => {
    expect(categoryToGoogle(null, cats)).toEqual({ colorId: null, extendedProperties: { private: { miosCategory: '', miosColor: '' } } });
    expect(categoryFromGoogle({ colorId: null, categoryProp: '', colorProp: '' }, cats)).toBeNull();
  });
  it('a color changed in Google picks the category with that color', () => {
    expect(categoryFromGoogle({ colorId: '5', categoryProp: 'sap', colorProp: '7' }, cats)).toBe('udem');
    expect(categoryFromGoogle({ colorId: null, categoryProp: 'sap', colorProp: '7' }, cats)).toBeNull();
  });
  it('an event born in Google takes the category of its color', () => {
    expect(categoryFromGoogle({ colorId: assignGoogleColors(cats).get('personal') }, cats)).toBe('personal');
    expect(categoryFromGoogle({}, cats)).toBeUndefined();
  });
  it('a color no category uses keeps what the app has', () => {
    expect(categoryFromGoogle({ colorId: '10', categoryProp: 'sap', colorProp: '7' }, cats)).toBeUndefined();
  });
  it('a deleted category falls back to the color', () => {
    expect(categoryFromGoogle({ colorId: '5', categoryProp: 'gone', colorProp: '2' }, cats)).toBe('udem');
    expect(categoryFromGoogle({ colorId: '2', categoryProp: 'gone', colorProp: '2' }, cats)).toBeNull();
  });
});

describe('reminders', () => {
  it('reads overrides, defaults and none', () => {
    expect(reminderFromGoogle({ useDefault: false, overrides: [{ method: 'popup', minutes: 30 }, { method: 'email', minutes: 1440 }] })).toBe(30);
    expect(reminderFromGoogle({ useDefault: true }, [{ minutes: 10 }])).toBe(10);
    expect(reminderFromGoogle({ useDefault: false, overrides: [] }, [{ minutes: 10 }])).toBeNull();
    expect(reminderFromGoogle(undefined, [])).toBeNull();
  });
  it('writes one popup', () => {
    expect(reminderToGoogle(15)).toEqual({ useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] });
    expect(reminderToGoogle(null)).toEqual({ useDefault: false, overrides: [] });
  });
});

describe('task time in notes', () => {
  it('appends and strips the time line', () => {
    const g = notesForGoogle('Revisar estado de cuenta', '10:00:00');
    expect(g).toBe('Revisar estado de cuenta\n\n🕒 10:00');
    expect(notesFromGoogle(g)).toEqual({ notes: 'Revisar estado de cuenta', time: '10:00' });
  });
  it('works without notes or without time', () => {
    expect(notesForGoogle(null, '09:30')).toBe('🕒 09:30');
    expect(notesFromGoogle('🕒 9:30')).toEqual({ notes: null, time: '09:30' });
    expect(notesForGoogle('Solo notas', null)).toBe('Solo notas');
    expect(notesFromGoogle('Solo notas')).toEqual({ notes: 'Solo notas', time: null });
    expect(notesFromGoogle('')).toEqual({ notes: null, time: null });
  });
  it('picks up a time edited in Google and ignores invalid ones', () => {
    expect(notesFromGoogle('Algo\n🕒 18:45')).toEqual({ notes: 'Algo', time: '18:45' });
    expect(notesFromGoogle('Algo\n🕒 25:00')).toEqual({ notes: 'Algo\n🕒 25:00', time: null });
  });
});
