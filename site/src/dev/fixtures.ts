// Dev only: what /api/athletes answers under ?data=worst|empty|one|error, so the ranking can be checked
// against the data it will meet, not only today's. Each worst-case value is one Smoothcomp could send,
// within the server's caps (worker.js: name 120, club 160, country name 80, user 12 digits, age 3–99).
import type { Athlete } from '@/lib/api';

const svg = (w: number, h: number) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#2871b8"/><rect width="${w / 2}" height="${h / 2}" fill="#e7bd28"/></svg>`)}`;

const base: Athlete = {
  user: '1', name: null, club: null, club_id: null, country: null, country_name: null, photo: null, born: null, hidden: null, belt: null, source: 'career',
  wins: 0, losses: 0, won: 0, lost: 0, submission: 0, points: 0, types: {}, gold: 0, silver: 0, bronze: 0, events: 0, at: null, last: null,
};
const row = (a: Partial<Athlete>): Athlete => ({ ...base, ...a, submission: a.types?.submission ?? 0, points: a.types?.points ?? 0 });

const worst: Athlete[] = [
  // Longest realistic name and club, four-digit wins, every finish type, a panorama photo.
  row({ user: '41207', name: 'Francisco Javier de los Santos Rodríguez García-Hernández', club: 'Checkmat International Brazilian Jiu-Jitsu & MMA Academy – Frankfurt am Main (Sachsenhausen)', club_id: '9001',
    country: 'es', country_name: 'Spain', belt: 'black', born: 1987, photo: svg(400, 40), wins: 1042, won: 1042, lost: 211,
    types: { submission: 412, points: 388, decision: 161, disqualification: 47, stoppage: 22, walkover: 140, other: 12 }, gold: 412, silver: 133, bronze: 96, events: 318, last: '2026-11-22T09:00:00Z' }),
  // No name, no photo, no club, country, belt or age: a results-only record with no losses known.
  row({ user: '987654321012', source: 'results', wins: 3, won: null, lost: null, losses: null, types: { submission: 2, points: 1 }, events: 1, last: null }),
  // Cyrillic with long words, a hidden profile, a photo that 404s, and 241–1 (rounds to 100%).
  row({ user: '55102', name: 'Нурмухаммед Динмухаммедов', club: 'Спортивный клуб «Барыс» Нур-Султан', club_id: '9002', country: 'kz', country_name: 'Kazakhstan', belt: 'purple', born: 2001,
    hidden: 1, photo: 'https://example.invalid/avatar.jpg', wins: 241, won: 241, lost: 1, types: { submission: 120, points: 101, decision: 20 }, gold: 88, silver: 9, bronze: 2, events: 92, last: '2026-10-11T09:00:00Z' }),
  // A six-year-old on a grey belt: short name and club, every count at 1.
  row({ user: '7', name: 'Jo Ng', club: 'GB', club_id: '9003', country: 'sg', country_name: 'Singapore', belt: 'grey', born: 2020, wins: 1, won: 1, lost: 0, types: { points: 1 }, gold: 1, events: 1, last: '2026-11-22T09:00:00Z' }),
  // Right-to-left name and club, a tall photo.
  row({ user: '66013', name: 'عبد الرحمن بن محمد الشامسي', club: 'نادي العين للجوجيتسو', club_id: '9004', country: 'ae', country_name: 'United Arab Emirates', belt: 'brown', born: 1995,
    photo: svg(40, 400), wins: 186, won: 186, lost: 40, types: { points: 99, submission: 60, decision: 27 }, gold: 51, silver: 30, bronze: 22, events: 77, last: '2026-11-15T09:00:00Z' }),
  // A flag emoji typed before the name, no photo: initials take the flag's first half.
  row({ user: '30311', name: '🇧🇷 Thiago Souza', club: 'Nova União', club_id: '9005', country: 'br', country_name: 'Brazil', belt: 'blue', born: 1999, wins: 74, won: 74, lost: 20, types: { submission: 50, points: 24 }, gold: 21, silver: 8, bronze: 6, events: 30, last: '2025-02-01T09:00:00Z' }),
  // A website for an academy name: one unbreakable string.
  row({ user: '30312', name: 'Đặng Thị Ngọc Hân', club: 'www.bjj-frankfurt-sachsenhausen-kampfsport.de', club_id: '9006', country: 'vn', country_name: 'Vietnam', belt: 'blue', born: 1998,
    wins: 68, won: 68, lost: 30, types: { points: 40, submission: 18, decision: 10 }, gold: 18, silver: 11, bronze: 12, events: 41, last: '2026-09-01T09:00:00Z' }),
  // All capitals, as many registrations arrive.
  row({ user: '30313', name: 'MAGOMEDKHABIB ABDULKHALIKOVICH NURMAGOMEDOV', club: 'EAGLES MMA', club_id: '9007', country: 'ru', country_name: 'Russia', belt: 'black', born: 1990,
    wins: 61, won: 61, lost: 3, types: { submission: 30, stoppage: 20, points: 11 }, gold: 30, silver: 2, bronze: 1, events: 33, last: '2023-05-01T09:00:00Z' }),
  // Only walkovers: no counted wins, 0–4.
  row({ user: '30314', name: 'Seán O\'Brien-Ó Súilleabháin', club: 'Fight & Fitness "Old School" Jiu-Jitsu', club_id: '9008', country: 'ie', country_name: 'Ireland', belt: 'white', born: 1979,
    wins: 0, won: 0, lost: 4, types: { walkover: 2 }, events: 3, last: '2026-03-01T09:00:00Z' }),
  // CJK name and club; a Scottish flag (a tag sequence some systems don't draw).
  row({ user: '30315', name: '王秀英', club: '北京巴西柔术俱乐部', club_id: '9009', country: 'cn', country_name: 'China', belt: 'purple', born: 1993,
    wins: 40, won: 40, lost: 12, types: { points: 25, submission: 15 }, gold: 12, silver: 6, bronze: 3, events: 19, last: '2026-06-01T09:00:00Z' }),
  row({ user: '30316', name: 'Lukas Müller', club: 'Fightzone Berlin', club_id: '9010', country: 'gb-sct', country_name: 'Scotland', belt: 'brown', born: 1991,
    wins: 39, won: 39, lost: 15, types: { submission: 20, points: 19 }, gold: 10, silver: 5, bronze: 9, events: 25, last: '2026-11-01T09:00:00Z' }),
  // The same name at another academy.
  row({ user: '30317', name: 'Lukas Müller', club: 'Kingdom JJ', club_id: '9011', country: 'de', country_name: 'Germany', belt: 'blue', born: 2004,
    wins: 38, won: 38, lost: 9, types: { points: 30, submission: 8 }, gold: 9, silver: 7, bronze: 4, events: 21, last: '2026-11-08T09:00:00Z' }),
  row({ user: '30318', name: 'Christopher Alexander Montgomery III', club: 'Gracie Barra', club_id: '9012', country: 'us', country_name: 'United States', belt: 'black', born: 1975,
    wins: 37, won: 37, lost: 37, types: { decision: 20, points: 17 }, gold: 3, silver: 9, bronze: 14, events: 52, last: '2014-03-01T09:00:00Z' }),
];

const one = [row({ user: '7', name: 'Jo Ng', club: 'GB', club_id: '9003', country: 'sg', country_name: 'Singapore', belt: 'grey', born: 2020, wins: 1, won: 1, lost: 0, types: { points: 1 }, gold: 1, events: 1, last: '2026-11-22T09:00:00Z' })];

export const STATES = ['worst', 'empty', 'one', 'error'] as const;

// undefined: no fixture for this route, so the real API answers.
export function fixture(route: string, state: string): unknown {
  if (route !== 'athletes') return undefined;
  if (state === 'error') throw Object.assign(new Error('HTTP 500'), { status: 500 });
  const rows = state === 'worst' ? worst : state === 'one' ? one : state === 'empty' ? [] : undefined;
  return rows && { rows, total: rows.length };
}
