import { CONFIG } from './config.js';

const base = CONFIG.apiBaseUrl;

async function get(path) {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

async function patch(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

async function del(path, body) {
  const res = await fetch(`${base}${path}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

async function adminGet(path, adminKey) {
  const res = await fetch(`${base}${path}`, { headers: { 'x-admin-key': adminKey } });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

async function adminPost(path, body, adminKey) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export const api = {
  getArtists:    ()             => get('/artists'),
  getArtist:     (id)           => get(`/artists/${id}`),
  getArtistGigs: (id)           => get(`/artists/${id}/gigs`),
  getGigs:       (params)       => get(`/gigs${params ? '?' + new URLSearchParams(params) : ''}`),
  getVenues:     ()             => get('/venues'),
  getVenue:      (slug)         => get(`/venues/${slug}`),
  getVenueGigs:  (slug)         => get(`/venues/${slug}/gigs`),

  // Artist claiming & editing (requires Cognito JWT)
  claimArtist:   (id, body, token) => post(`/artists/${id}/claim`, body, token),
  updateArtist:  (id, body, token) => patch(`/artists/${id}`, body, token),

  // Follows / email alerts
  followTarget:  (email, targetId, targetType, targetName) =>
    post('/follows', { email, targetId, targetType, targetName }),
  unfollowTarget: (email, targetId) =>
    del('/follows', { email, targetId }),
  checkFollow:   (email, targetId) =>
    get(`/follows/check?${new URLSearchParams({ email, targetId })}`),

  // Admin endpoints (requires admin key)
  adminGetArtists:   (key)       => adminGet('/admin/artists', key),
  adminSetGenres:    (id, genres, key) => adminPost(`/admin/artists/${id}/genres`, { genres }, key),
  adminGetClaims:    (key)       => adminGet('/admin/claims', key),
  adminApproveClaim: (id, key)   => adminPost(`/admin/claims/${id}/approve`, {}, key),
  adminRejectClaim:  (id, key)   => adminPost(`/admin/claims/${id}/reject`, {}, key),
};
