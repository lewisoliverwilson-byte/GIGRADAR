import { CONFIG } from './config.js';

const base = CONFIG.apiBaseUrl;

async function get(path) {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export const api = {
  getArtists:    ()         => get('/artists'),
  getArtist:     (id)       => get(`/artists/${id}`),
  getArtistGigs: (id)       => get(`/artists/${id}/gigs`),
  getGigs:       (params)   => get(`/gigs${params ? '?' + new URLSearchParams(params) : ''}`),
};
