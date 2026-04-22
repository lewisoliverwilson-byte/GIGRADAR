import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { api } from '../utils/api.js';
import { getToken } from '../utils/cognito.js';
import { useAuth } from '../context/AuthContext.jsx';
import GigCard from '../components/GigCard.jsx';
import AlertButton from '../components/AlertButton.jsx';
import Footer from '../components/Footer.jsx';

function venueColor(venueId) {
  const palette = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#ef4444', '#6366f1'];
  let h = 0;
  for (let i = 0; i < (venueId || '').length; i++) h = (h * 31 + venueId.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function venueInitials(name) {
  return (name || '').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'V';
}

const TYPE_LABELS = {
  pub: 'Pub', club: 'Club', theatre: 'Theatre', academy: 'Academy',
  arena: 'Arena', 'arts-centre': 'Arts Centre', other: 'Venue',
};

export default function VenuePage({ initialVenue = null }) {
  const { query: { slug } } = useRouter();
  const { user, openAuth } = useAuth();
  const [venue, setVenue] = useState(initialVenue);
  const [gigs, setGigs] = useState([]);
  const [discoveredCount, setDiscoveredCount] = useState(0);
  const [loading, setLoading] = useState(!initialVenue);
  const [tab, setTab] = useState('upcoming');
  const [showClaim, setShowClaim] = useState(false);
  const [claimDone, setClaimDone] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (!slug) return;
    if (!initialVenue) setLoading(true);
    const venueFetch = initialVenue ? Promise.resolve(initialVenue) : api.getVenue(slug);
    Promise.all([venueFetch, api.getVenueGigs(slug)])
      .then(([v, g]) => {
        setVenue(v);
        // getVenueGigs returns { gigs, discoveredCount } or legacy array
        if (Array.isArray(g)) { setGigs(g); } else { setGigs(g.gigs || []); setDiscoveredCount(g.discoveredCount || 0); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <Skeleton />;

  if (!venue) return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-zinc-400 mb-4 text-lg">Venue not found.</p>
          <Link href="/venues" className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold px-6 py-2.5 rounded-xl transition-colors">
            ← Browse venues
          </Link>
        </div>
      </div>
      <Footer />
    </div>
  );

  const today = new Date().toISOString().split('T')[0];
  const upcoming = gigs.filter(g => g.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = gigs.filter(g => g.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const color = venueColor(venue.venueId);
  const isClaimed = !!venue.claimedBy;
  const isOwner = user && venue.claimedBy === user.sub;
  const canClaim = !isClaimed && !claimDone;

  function startEdit() {
    setEditData({
      bio: venue.bio || '',
      website: venue.website || '',
      instagram: venue.instagram || '',
      facebook: venue.facebook || '',
      bookingEmail: venue.bookingEmail || '',
      imageUrl: venue.imageUrl || '',
      capacity: venue.capacity ? String(venue.capacity) : '',
    });
    setEditing(true);
    setSaveError('');
  }

  async function saveEdit() {
    setSaving(true); setSaveError('');
    try {
      const token = await getToken();
      if (!token) throw new Error('Please sign in again.');
      const rawData = { ...editData };
      if (rawData.capacity) rawData.capacity = parseInt(rawData.capacity) || undefined;
      const changed = Object.fromEntries(
        Object.entries(rawData).filter(([k, v]) => v !== (String(venue[k] || '')))
      );
      if (Object.keys(changed).length > 0) {
        await api.updateVenue(venue.slug, changed, token);
        setVenue(v => ({ ...v, ...changed }));
      }
      setEditing(false);
    } catch (err) {
      setSaveError(err.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950">

      {/* Hero */}
      <div className="relative h-56 sm:h-72 overflow-hidden" style={{ background: color + '33' }}>
        {(venue.photoUrl || venue.imageUrl) ? (
          <img
            src={venue.photoUrl || venue.imageUrl}
            alt={venue.name}
            className="w-full h-full object-cover opacity-60"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-8xl font-black opacity-10" style={{ color }}>{venueInitials(venue.name)}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/50 to-transparent" />
      </div>

      <div className="max-w-5xl mx-auto px-6 -mt-20 relative pb-10">

        {/* Header */}
        <div className="flex flex-col sm:flex-row gap-6 items-start mb-6">
          <div
            className="w-28 h-28 rounded-2xl border-4 border-zinc-950 overflow-hidden flex-shrink-0 shadow-2xl flex items-center justify-center"
            style={{ background: color + '33' }}
          >
            {(venue.photoUrl || venue.imageUrl)
              ? <img src={venue.photoUrl || venue.imageUrl} alt={venue.name} className="w-full h-full object-cover" />
              : <span className="text-4xl font-black" style={{ color }}>{venueInitials(venue.name)}</span>
            }
          </div>

          <div className="flex-1 min-w-0 pt-1">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  {venue.venueType && venue.venueType !== 'other' && (
                    <span className="inline-block bg-zinc-800 text-zinc-300 text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded">
                      {TYPE_LABELS[venue.venueType] || 'Venue'}
                    </span>
                  )}
                  {venue.isGrassroots && (
                    <span className="inline-flex items-center gap-1 bg-emerald-950 text-emerald-400 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-emerald-800">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
                      Grassroots
                    </span>
                  )}
                  {venue.verified && (
                    <span className="inline-flex items-center gap-1 bg-violet-900 text-violet-300 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-violet-700">
                      <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                      Verified
                    </span>
                  )}
                </div>
                <h1 className="text-3xl sm:text-4xl font-black text-white leading-tight mb-1">{venue.name}</h1>
                <div className="flex items-center gap-3 text-sm text-zinc-400 flex-wrap">
                  {venue.city && <span>{venue.city}</span>}
                  {venue.capacity && (
                    <span className="text-zinc-600">· Cap. {venue.capacity.toLocaleString()}</span>
                  )}
                  {upcoming.length > 0 && (
                    <span className="inline-flex items-center bg-violet-900 text-violet-300 text-xs font-semibold px-2 py-0.5 rounded-md border border-violet-700">
                      {upcoming.length} upcoming {upcoming.length === 1 ? 'gig' : 'gigs'}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <AlertButton targetId={venue.venueId} targetType="venue" targetName={venue.name} />
              </div>
            </div>

            {venue.genres?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {venue.genres.slice(0, 5).map(g => (
                  <Link key={g} href={`/gigs?genre=${encodeURIComponent(g)}`}
                    className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs px-2 py-0.5 rounded-md transition-colors capitalize">
                    {g}
                  </Link>
                ))}
              </div>
            )}

            {/* Stats row */}
            {(venue.followerCount > 0 || discoveredCount > 0) && (
              <div className="flex items-center gap-4 mt-3 flex-wrap">
                {venue.followerCount > 0 && (
                  <span className="text-xs text-zinc-400">
                    <span className="font-semibold text-white">{venue.followerCount.toLocaleString()}</span> follower{venue.followerCount !== 1 ? 's' : ''}
                  </span>
                )}
                {discoveredCount > 0 && (
                  <span className="inline-flex items-center gap-1 bg-amber-950 text-amber-400 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-amber-800"
                    title="Artists who played here and now have 50k+ monthly Spotify listeners">
                    ⚡ Discovered {discoveredCount} {discoveredCount === 1 ? 'artist' : 'artists'}
                  </span>
                )}
              </div>
            )}

            {venue.bio && (
              <p className="text-zinc-400 text-sm leading-relaxed max-w-2xl mt-3">{venue.bio}</p>
            )}

            {venue.address && (
              <p className="text-xs text-zinc-500 mt-2 flex items-center gap-1">
                <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                {venue.address}
              </p>
            )}

            {venue.capacity && (
              <p className="text-xs text-zinc-500 mt-1">Capacity: {venue.capacity.toLocaleString()}</p>
            )}

            {!editing && (
              <div className="flex items-center gap-4 mt-3 flex-wrap">
                {venue.website && (
                  <a href={venue.website} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-zinc-500 hover:text-white transition-colors flex items-center gap-1">
                    Website <span className="opacity-60">↗</span>
                  </a>
                )}
                {venue.instagram && (
                  <a href={`https://instagram.com/${venue.instagram.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-zinc-500 hover:text-white transition-colors flex items-center gap-1">
                    Instagram <span className="opacity-60">↗</span>
                  </a>
                )}
                {venue.wikiUrl && (
                  <a href={venue.wikiUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-zinc-500 hover:text-white transition-colors flex items-center gap-1">
                    Wikipedia <span className="opacity-60">↗</span>
                  </a>
                )}
                {venue.bookingEmail && (
                  <a href={`mailto:${venue.bookingEmail}`}
                    className="text-xs text-zinc-500 hover:text-white transition-colors flex items-center gap-1">
                    Book <span className="opacity-60">✉</span>
                  </a>
                )}
              </div>
            )}

            {editing && (
              <div className="mt-4 space-y-3 max-w-lg bg-zinc-900 border border-zinc-700 rounded-2xl p-5">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Bio</label>
                  <textarea value={editData.bio} onChange={e => setEditData(d => ({ ...d, bio: e.target.value }))}
                    rows={3} className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-xl px-3 py-2 focus:outline-none focus:border-violet-500 resize-none text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[['website', 'Website'], ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['bookingEmail', 'Booking email'], ['imageUrl', 'Photo URL'], ['capacity', 'Capacity']].map(([k, label]) => (
                    <div key={k}>
                      <label className="block text-xs text-zinc-500 mb-1.5 font-medium">{label}</label>
                      <input value={editData[k] || ''} onChange={e => setEditData(d => ({ ...d, [k]: e.target.value }))}
                        className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-xl px-3 py-2 focus:outline-none focus:border-violet-500 text-sm" />
                    </div>
                  ))}
                </div>
                {saveError && <p className="text-red-400 text-xs">{saveError}</p>}
                <div className="flex gap-2">
                  <button onClick={saveEdit} disabled={saving}
                    className="bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm py-2 px-5 rounded-xl transition-colors disabled:opacity-50">
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                  <button onClick={() => setEditing(false)} className="text-zinc-400 hover:text-white text-sm py-2 px-4 rounded-xl transition-colors">Cancel</button>
                </div>
              </div>
            )}

            {!editing && (
              <div className="flex items-center gap-3 flex-wrap mt-3">
                {isOwner && (
                  <button onClick={startEdit}
                    className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors border border-zinc-700 rounded-lg px-3 py-1.5 hover:border-zinc-500">
                    Edit venue profile
                  </button>
                )}
                {canClaim && (
                  <button onClick={() => user ? setShowClaim(true) : openAuth('signup')}
                    className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors">
                    Is this your venue? →
                  </button>
                )}
                {claimDone && (
                  <span className="text-xs text-emerald-400">Claim submitted — we'll be in touch.</span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-zinc-800 mb-6" />

        {/* Tabs */}
        <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1 w-fit mb-6">
          {[['upcoming', `Upcoming (${upcoming.length})`], ['past', `Past (${past.length})`]].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === key ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {(tab === 'upcoming' ? upcoming : past).length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center">
            <p className="text-5xl mb-4">{tab === 'upcoming' ? '🎸' : '📅'}</p>
            <p className="text-white font-bold">
              {tab === 'upcoming' ? 'No upcoming gigs' : 'No past gigs on record'}
            </p>
            <p className="text-sm text-zinc-500 mt-1">
              {tab === 'upcoming'
                ? 'Follow this venue to get alerted when new gigs are added.'
                : 'We only have data going back a short while.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {(tab === 'upcoming' ? upcoming : past).map(g => (
              <GigCard key={g.gigId} gig={g} showArtist />
            ))}
          </div>
        )}
      </div>

      <Footer />

      {showClaim && (
        <VenueClaimModal
          venue={venue}
          onClose={() => setShowClaim(false)}
          onSuccess={() => { setShowClaim(false); setClaimDone(true); }}
        />
      )}
    </div>
  );
}

function VenueClaimModal({ venue, onClose, onSuccess }) {
  const { user } = useAuth();
  const [email, setEmail] = useState(user?.email || '');
  const [role, setRole] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!email || !role) { setError('Email and role are required.'); return; }
    setSubmitting(true); setError('');
    try {
      const token = await getToken();
      if (!token) throw new Error('Please sign in first.');
      await api.claimVenue(venue.slug, { email, role, note }, token);
      onSuccess();
    } catch (err) {
      setError(err.message || 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-white">Claim {venue.name}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors text-xl leading-none">×</button>
        </div>
        <p className="text-sm text-zinc-400 mb-5 leading-relaxed">
          Are you the owner, promoter, or manager of this venue? Claim it to add photos, update your bio, and manage your listing.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Your email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-xl px-3 py-2.5 focus:outline-none focus:border-violet-500 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Your role</label>
            <select value={role} onChange={e => setRole(e.target.value)} required
              className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-xl px-3 py-2.5 focus:outline-none focus:border-violet-500 text-sm">
              <option value="">Select…</option>
              <option value="owner">Owner / Manager</option>
              <option value="promoter">Promoter</option>
              <option value="booking">Booking agent</option>
              <option value="staff">Staff</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Anything else? (optional)</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-xl px-3 py-2 focus:outline-none focus:border-violet-500 text-sm resize-none"
              placeholder="e.g. website, social, or proof of ownership…" />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-3">
            <button type="submit" disabled={submitting}
              className="flex-1 bg-violet-600 hover:bg-violet-500 text-white font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-50 text-sm">
              {submitting ? 'Submitting…' : 'Submit claim'}
            </button>
            <button type="button" onClick={onClose}
              className="px-5 text-zinc-400 hover:text-white text-sm transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="h-56 sm:h-72 bg-zinc-800 animate-pulse" />
      <div className="max-w-5xl mx-auto px-6 -mt-20 relative pb-10">
        <div className="flex gap-6 items-start">
          <div className="w-28 h-28 bg-zinc-800 animate-pulse rounded-2xl flex-shrink-0" />
          <div className="flex-1 pt-4 space-y-3">
            <div className="h-9 bg-zinc-800 animate-pulse rounded-xl w-64" />
            <div className="h-4 bg-zinc-800 animate-pulse rounded w-32" />
          </div>
        </div>
        <div className="border-t border-zinc-800 mt-6 mb-6" />
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-20 bg-zinc-800 animate-pulse rounded-xl" />)}
        </div>
      </div>
    </div>
  );
}
