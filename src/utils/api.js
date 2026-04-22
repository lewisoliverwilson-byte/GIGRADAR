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
  getArtists:        ()             => get('/artists'),
  getArtist:         (id)           => get(`/artists/${id}`),
  getArtistGigs:     (id)           => get(`/artists/${id}/gigs`),
  getSimilarArtists: (id)           => get(`/artists/${id}/similar`),
  getArtistSetlists: (id)           => get(`/artists/${id}/setlists`),
  getGig:            (id)           => get(`/gigs/${encodeURIComponent(id)}`),
  getGigs:           (params)       => get(`/gigs${params ? '?' + new URLSearchParams(params) : ''}`),
  getNearbyGigs:     (lat, lng, radius = 15, genre) =>
    get(`/gigs/nearby?lat=${lat}&lng=${lng}&radius=${radius}${genre ? '&genre='+encodeURIComponent(genre) : ''}`),
  getTrending:       ()             => get('/trending'),
  getEmerging:       ()             => get('/emerging'),
  getEarlyRadar:     ()             => get('/early-radar'),
  getGrassroots:     (params)       => get(`/grassroots${params ? '?' + new URLSearchParams(params) : ''}`),
  getOnSale:         (params)       => get(`/on-sale${params ? '?' + new URLSearchParams(params) : ''}`),
  getComingSoon:     (params)       => get(`/coming-soon${params ? '?' + new URLSearchParams(params) : ''}`),
  getVenuesFeatured: ()             => get('/venues/featured'),
  getVenues:         ()             => get('/venues'),
  getVenuesFiltered: (params)       => get(`/venues?${new URLSearchParams(params)}`),
  getVenue:          (slug)         => get(`/venues/${slug}`),
  getVenueGigs:      (slug)         => get(`/venues/${slug}/gigs`),
  search:            (q)            => get(`/search?q=${encodeURIComponent(q)}`),

  // Artist claiming & editing (requires Cognito JWT)
  claimArtist:   (id, body, token)        => post(`/artists/${id}/claim`, body, token),
  updateArtist:  (id, body, token)        => patch(`/artists/${id}`, body, token),

  // Venue claiming & editing (requires Cognito JWT)
  claimVenue:          (slug, body, token) => post(`/venues/${slug}/claim`, body, token),
  updateVenue:         (slug, body, token) => patch(`/venues/${slug}`, body, token),
  trackVenueView:      (slug)             => post(`/venues/${slug}/view`, {}),
  getVenueAnalytics:   (slug, token)      => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`${base}/venues/${slug}/analytics`, { headers }).then(r => r.ok ? r.json() : Promise.reject(r));
  },

  // Follows / email alerts
  followTarget:  (email, targetId, targetType, targetName) =>
    post('/follows', { email, targetId, targetType, targetName }),
  unfollowTarget: (email, targetId) =>
    del('/follows', { email, targetId }),
  checkFollow:   (email, targetId) =>
    get(`/follows/check?${new URLSearchParams({ email, targetId })}`),

  // Admin endpoints (requires admin key)
  adminGetArtists:        (key)             => adminGet('/admin/artists', key),
  adminSetGenres:         (id, genres, key) => adminPost(`/admin/artists/${id}/genres`, { genres }, key),
  adminGetClaims:         (key)             => adminGet('/admin/claims', key),
  adminApproveClaim:      (id, key)         => adminPost(`/admin/claims/${id}/approve`, {}, key),
  adminRejectClaim:       (id, key)         => adminPost(`/admin/claims/${id}/reject`, {}, key),
  adminGetVenueClaims:    (key)             => adminGet('/admin/venue-claims', key),
  adminApproveVenueClaim: (id, key)         => adminPost(`/admin/venue-claims/${id}/approve`, {}, key),
  adminRejectVenueClaim:  (id, key)         => adminPost(`/admin/venue-claims/${id}/reject`, {}, key),
};
