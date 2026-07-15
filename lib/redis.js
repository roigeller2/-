import { Redis } from '@upstash/redis';

// לקוח Upstash ישיר, מאותחל במפורש עם cache: 'no-store' ו-enableAutoPipelining: false
// (התיקון לבאג ה-null-flicker). משותף לכל ה-Route Handlers בצד השרת.
export const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
  cache: 'no-store',
  enableAutoPipelining: false,
});
