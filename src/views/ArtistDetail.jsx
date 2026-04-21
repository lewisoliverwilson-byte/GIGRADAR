import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { api } from '../utils/api.js';
import { getToken } from '../utils/cognito.js';
import { artistInitials, artistColor } from '../utils/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import FollowButton from '../components/FollowButton.jsx';
import AlertButton from '../components/AlertButton.jsx';
import GigCard from '../components/GigCard.jsx';
import ClaimModal from '../components/ClaimModal.jsx';
import Footer from '../components/Footer.jsx';

const imageCache = {};
async function fetchWikiImage(wikipedia) {
  if (!wikipedia) return null;
  if (imageCache[wikipedia] !== undefined) return imageCache[wikipedia];
  try {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikipedia)}`);
    const data = await res.json();
    const url = data?.originalimage?.source || data?.thumbnail?.source || null;
    imageCache[wikipedia] = url;
    return url;
  } catch { imageCache[wikipedia] = null; return null; }
}

export default function ArtistDetail({ initialArtist = null }) {
  const { query: { id } } = useRouter();
  const { user, openAuth } = useAuth();

  const [artist, setArtist] = useState(initialArtist);
  const [gigs, setGigs] = useState([]);
  const [similar, setSimilar] = useState([]);
  const [imgUrl, setImgUrl] = useState(null);
  const [tab, setTab] = useState('upcoming');
  const [loading, setLoading] = useState(!initialArtist);
  const [error, setError] = useState(false);
  const [showClaim, setShowClaim] = useState(false);
  const [claimDone, setClaimDone] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (!id) return;
    if (!initialArtist) setLoading(true);
    setError(false);
    const artistFetch = initialArtist ? Promise.resolve(initialArtist) : api.getArtist(id);
    Promise.all([artistFetch, api.getArtistGigs(id)])
      .then(([a, g]) => {
        setArtist(a);
        setGigs(g);
        api.getSimilarArtists(id).then(setSimilar).catch(() => {});
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!artist) return;
    if (artist.imageUrl) { setImgUrl(artist.imageUrl); return; }
    fetchWikiImage(artist.wikipedia).then(setImgUrl);
  }, [artist]);

  function startEdit() {
    setEditData({
      bio: artist.bio || '',
      imageUrl: artist.imageUrl || '',
      website: artist.website || '',
      spotify: artist.spotify || '',
      instagram: artist.instagram || '',
      facebook: artist.facebook || '',
    });
    setEditing(true);
    setSaveError('');
  }

  async function saveEdit() {
    setSaving(true); setSaveError('');
    try {
      const token = await getToken();
      if (!token) throw new Error('Please sign in again.');
      const changed = Object.fromEntries(
        Object.entries(editData).filter(([k, v]) => v !== (artist[k] || ''))
      );
      if (Object.keys(changed).length > 0) {
        await api.updateArtist(artist.artistId, changed, token);
        setArtist(a => ({ ...a, ...changed }));
      }
      setEditing(false);
    } catch (err) {
      setSaveError(err.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Skeleton />;
  if (error || !artist) return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-zinc-400 mb-4 text-lg">Artist not found.</p>
          <Link href="/artists" className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold px-6 py-2.5 rounded-xl transition-colors">
            ← Back to artists
          </Link>
        </div>
      </div>
      <Footer />
    </div>
  );

  const today = new Date().toISOString().split('T')[0];
  const upcoming = gigs.filter(g => g.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = gigs.filter(g => g.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const shown = tab === 'upcoming' ? upcoming : past;
  const color = artist.color || artistColor(artist.artistId);
  const isClaimed = !!artist.claimedBy;
  const isOwner = user && artist.claimedBy === user.sub;
  const canClaim = !isClaimed && !claimDone;

  return (
    <div className="min-h-screen bg-zinc-950">

      {/* Hero banner */}
      <div className="relative h-56 sm:h-72 overflow-hidden" style={{ background: color + '33' }}>
        {imgUrl && (
          <img src={imgUrl} alt={artist.name}
            className="w-full h-full object-cover object-top opacity-30" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/40 to-transparent" />
      </div>

      {/* Profile card */}
      <div className="max-w-5xl mx-auto px-6 -mt-20 relative pb-10">
        <div className="flex flex-col sm:flex-row gap-6 items-start">

          {/* Avatar */}
          <div
            className="w-28 h-28 sm:w-32 sm:h-32 rounded-2xl border-4 border-zinc-950 overflow-hidden flex-shrink-0 shadow-2xl"
            style={{ background: color + '33' }}
          >
            {imgUrl
              ? <img src={imgUrl} alt={artist.name} className="w-full h-full object-cover object-top" />
              : <div className="w-full h-full flex items-center justify-center text-3xl font-black" style={{ color }}>
                  {artistInitials(artist.name)}
                </div>
            }
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0 pt-1">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap mb-1">
                  <h1 className="text-3xl sm:text-4xl font-black text-white leading-tight">{artist.name}</h1>
                  {artist.verified && (
                    <span className="flex items-center gap-1 bg-violet-900 text-violet-300 text-xs font-semibold px-2.5 py-1 rounded-full border border-violet-700">
                      <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Verified
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-3">
                  {artist.genres?.slice(0, 4).map(g => (
                    <Link key={g} href={`/gigs?genre=${encodeURIComponent(g)}`}
                      className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs px-2 py-0.5 rounded-md transition-colors">
                      {g}
                    </Link>
                  ))}
                  {artist.mbCountry && (
                    <span className="text-xs text-zinc-500">{artist.mbCountry}</span>
                  )}
                  {artist.monthlyListeners > 0 && (
                    <span className="text-xs text-zinc-500">{artist.monthlyListeners.toLocaleString()} monthly listeners</span>
                  )}
                  {artist.lastfmRank && (
                    <span className="text-xs text-zinc-600">#{artist.lastfmRank} in UK</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <FollowButton artistId={artist.artistId} />
                <AlertButton targetId={artist.artistId} targetType="artist" targetName={artist.name} />
              </div>
            </div>

            {!editing && artist.bio && (
              <p className="text-zinc-400 text-sm leading-relaxed max-w-2xl mb-3">{artist.bio}</p>
            )}

            {!editing && (
              <div className="flex items-center gap-4 flex-wrap mb-3">
                {artist.website && (
                  <a href={artist.website} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-zinc-500 hover:text-white transition-colors flex items-center gap-1">
                    Website <span className="opacity-60">↗</span>
                  </a>
                )}
                {artist.spotify && (
                  <a href={artist.spotify} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-zinc-500 hover:text-white transition-colors flex items-center gap-1">
                    Spotify <span className="opacity-60">↗</span>
                  </a>
                )}
                {artist.instagram && (
                  <a href={artist.instagram} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-zinc-500 hover:text-white transition-colors flex items-center gap-1">
                    Instagram <span className="opacity-60">↗</span>
                  </a>
                )}
                {artist.facebook && (
                  <a href={artist.facebook} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-zinc-500 hover:text-white transition-colors flex items-center gap-1">
                    Facebook <span className="opacity-60">↗</span>
                  </a>
                )}
                {artist.wikiUrl && (
                  <a href={artist.wikiUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-zinc-500 hover:text-white transition-colors flex items-center gap-1">
                    Wikipedia <span className="opacity-60">↗</span>
                  </a>
                )}
              </div>
            )}

            {editing && (
              <div className="mt-4 space-y-3 max-w-lg bg-zinc-900 border border-zinc-700 rounded-2xl p-5">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Bio</label>
                  <textarea
                    value={editData.bio}
                    onChange={e => setEditData(d => ({ ...d, bio: e.target.value }))}
                    rows={3}
                    className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-xl px-3 py-2 focus:outline-none focus:border-violet-500 resize-none text-sm placeholder-zinc-500"
                    placeholder="Tell people about the band…"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Photo URL</label>
                  <input
                    value={editData.imageUrl}
                    onChange={e => setEditData(d => ({ ...d, imageUrl: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-xl px-3 py-2 focus:outline-none focus:border-violet-500 text-sm placeholder-zinc-500"
                    placeholder="https://..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[['website', 'Website'], ['spotify', 'Spotify'], ['instagram', 'Instagram'], ['facebook', 'Facebook']].map(([k, label]) => (
                    <div key={k}>
                      <label className="block text-xs text-zinc-500 mb-1.5 font-medium">{label}</label>
                      <input
                        value={editData[k]}
                        onChange={e => setEditData(d => ({ ...d, [k]: e.target.value }))}
                        className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-xl px-3 py-2 focus:outline-none focus:border-violet-500 text-sm placeholder-zinc-500"
                        placeholder="https://..."
                      />
                    </div>
                  ))}
                </div>
                {saveError && <p className="text-red-400 text-xs">{saveError}</p>}
                <div className="flex gap-2">
                  <button onClick={saveEdit} disabled={saving}
                    className="bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm py-2 px-5 rounded-xl transition-colors disabled:opacity-50">
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                  <button onClick={() => setEditing(false)}
                    className="text-zinc-400 hover:text-white text-sm py-2 px-4 rounded-xl transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {!editing && (
              <div className="flex items-center gap-3 flex-wrap">
                {isOwner && (
                  <button onClick={startEdit}
                    className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors border border-zinc-700 rounded-lg px-3 py-1.5 hover:border-zinc-500">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit profile
                  </button>
                )}
                {canClaim && (
                  <button onClick={() => user ? setShowClaim(true) : openAuth('signup')}
                    className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors">
                    Is this your band? →
                  </button>
                )}
                {claimDone && (
                  <span className="text-xs text-emerald-400">Claim submitted — we'll be in touch.</span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-zinc-800 mt-10 mb-6" />

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

        {shown.length > 0 ? (
          <div className="space-y-2">
            {shown.map(g => <GigCard key={g.gigId} gig={g} />)}
          </div>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center">
            <p className="text-5xl mb-4">{tab === 'upcoming' ? '🎸' : '📅'}</p>
            <p className="text-white font-bold">
              {tab === 'upcoming' ? 'No upcoming gigs' : 'No past gigs on record'}
            </p>
            <p className="text-sm text-zinc-500 mt-1">
              {tab === 'upcoming'
                ? 'Follow this artist to get alerted when they announce a show.'
                : 'We only have data going back a short while.'}
            </p>
          </div>
        )}
      </div>

      {similar.length > 0 && (
        <div className="max-w-5xl mx-auto px-6 pb-10">
          <div className="border-t border-zinc-800 mb-6" />
          <h2 className="text-lg font-bold text-white mb-4">Similar artists</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {similar.slice(0, 12).map(a => (
              <SimilarArtistCard key={a.artistId} artist={a} />
            ))}
          </div>
        </div>
      )}

      {showClaim && (
        <ClaimModal
          artist={artist}
          onClose={() => setShowClaim(false)}
          onSuccess={() => { setShowClaim(false); setClaimDone(true); }}
        />
      )}

      <Footer />
    </div>
  );
}

function SimilarArtistCard({ artist }) {
  const color = artist.color || artistColor(artist.artistId);
  return (
    <Link href={`/artists/${artist.artistId}`}
      className="group flex flex-col items-center gap-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-xl p-3 transition-colors text-center">
      <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0" style={{ background: color + '33' }}>
        {artist.imageUrl
          ? <img src={artist.imageUrl} alt={artist.name} className="w-full h-full object-cover object-top" />
          : <div className="w-full h-full flex items-center justify-center text-lg font-black" style={{ color }}>
              {artistInitials(artist.name)}
            </div>
        }
      </div>
      <div className="min-w-0 w-full">
        <p className="text-xs font-semibold text-white truncate group-hover:text-violet-300 transition-colors">{artist.name}</p>
        {artist.upcoming > 0 && (
          <p className="text-xs text-zinc-500">{artist.upcoming} gig{artist.upcoming !== 1 ? 's' : ''}</p>
        )}
      </div>
    </Link>
  );
}

function Skeleton() {
  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="h-56 sm:h-72 bg-zinc-800 animate-pulse" />
      <div className="max-w-5xl mx-auto px-6 -mt-20 relative pb-10">
        <div className="flex gap-6 items-start">
          <div className="w-32 h-32 bg-zinc-800 animate-pulse rounded-2xl flex-shrink-0" />
          <div className="flex-1 pt-4 space-y-3">
            <div className="h-9 bg-zinc-800 animate-pulse rounded-xl w-56" />
            <div className="h-4 bg-zinc-800 animate-pulse rounded w-40" />
            <div className="h-4 bg-zinc-800 animate-pulse rounded w-full max-w-lg" />
          </div>
        </div>
        <div className="border-t border-zinc-800 mt-10 mb-6" />
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-zinc-800 animate-pulse rounded-xl" />)}
        </div>
      </div>
    </div>
  );
}
