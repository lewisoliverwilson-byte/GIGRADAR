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
    const res  = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikipedia)}`);
    const data = await res.json();
    const url  = data?.originalimage?.source || data?.thumbnail?.source || null;
    imageCache[wikipedia] = url;
    return url;
  } catch { imageCache[wikipedia] = null; return null; }
}

export default function ArtistDetail() {
  const { query: { id } } = useRouter();
  const { user, openAuth } = useAuth();

  const [artist, setArtist]   = useState(null);
  const [gigs, setGigs]       = useState([]);
  const [imgUrl, setImgUrl]   = useState(null);
  const [tab, setTab]         = useState('upcoming');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  const [showClaim, setShowClaim] = useState(false);
  const [claimDone, setClaimDone] = useState(false);

  const [editing, setEditing]     = useState(false);
  const [editData, setEditData]   = useState({});
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true); setError(false);
    Promise.all([api.getArtist(id), api.getArtistGigs(id)])
      .then(([a, g]) => { setArtist(a); setGigs(g); })
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
      bio:       artist.bio       || '',
      imageUrl:  artist.imageUrl  || '',
      website:   artist.website   || '',
      spotify:   artist.spotify   || '',
      instagram: artist.instagram || '',
      facebook:  artist.facebook  || '',
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
    <div className="min-h-screen bg-surface flex flex-col">
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-zinc-400 mb-4 text-lg">Artist not found.</p>
          <Link href="/artists" className="btn-secondary px-6 py-2.5 rounded-xl">← Back to artists</Link>
        </div>
      </div>
      <Footer />
    </div>
  );

  const today    = new Date().toISOString().split('T')[0];
  const upcoming = gigs.filter(g => g.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past     = gigs.filter(g => g.date <  today).sort((a, b) => b.date.localeCompare(a.date));
  const shown    = tab === 'upcoming' ? upcoming : past;
  const color    = artist.color || artistColor(artist.artistId);
  const isClaimed = !!artist.claimedBy;
  const isOwner  = user && artist.claimedBy === user.sub;
  const canClaim = !isClaimed && !claimDone;

  return (
    <div className="min-h-screen bg-surface">

      {/* Hero banner */}
      <div className="relative h-56 sm:h-72 overflow-hidden" style={{ background: color + '22' }}>
        {imgUrl && (
          <img src={imgUrl} alt={artist.name}
            className="w-full h-full object-cover object-top opacity-30" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-surface/40 to-transparent" />
      </div>

      {/* Profile card */}
      <div className="section -mt-20 relative pb-10">
        <div className="flex flex-col sm:flex-row gap-6 items-start">

          {/* Avatar */}
          <div
            className="w-28 h-28 sm:w-32 sm:h-32 rounded-2xl border-4 border-surface overflow-hidden flex-shrink-0 shadow-2xl"
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
                    <span className="flex items-center gap-1 bg-brand/15 text-brand-light text-xs font-semibold px-2.5 py-1 rounded-full border border-brand/30">
                      <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Verified
                    </span>
                  )}
                </div>

                {/* Meta row */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  {artist.genres?.slice(0, 3).map(g => (
                    <span key={g} className="badge-gray text-xs">{g}</span>
                  ))}
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

            {/* Bio */}
            {!editing && artist.bio && (
              <p className="text-zinc-400 text-sm leading-relaxed max-w-2xl mb-3">{artist.bio}</p>
            )}

            {/* Social links */}
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
              </div>
            )}

            {/* Edit form */}
            {editing && (
              <div className="mt-4 space-y-3 max-w-lg bg-surface-2 border border-white/5 rounded-2xl p-5">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Bio</label>
                  <textarea
                    value={editData.bio}
                    onChange={e => setEditData(d => ({ ...d, bio: e.target.value }))}
                    rows={3}
                    className="input w-full resize-none text-sm"
                    placeholder="Tell people about the band…"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Photo URL</label>
                  <input
                    value={editData.imageUrl}
                    onChange={e => setEditData(d => ({ ...d, imageUrl: e.target.value }))}
                    className="input w-full text-sm"
                    placeholder="https://..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[['website','Website'],['spotify','Spotify'],['instagram','Instagram'],['facebook','Facebook']].map(([k, label]) => (
                    <div key={k}>
                      <label className="block text-xs text-zinc-500 mb-1.5 font-medium">{label}</label>
                      <input
                        value={editData[k]}
                        onChange={e => setEditData(d => ({ ...d, [k]: e.target.value }))}
                        className="input w-full text-sm"
                        placeholder="https://..."
                      />
                    </div>
                  ))}
                </div>
                {saveError && <p className="text-red-400 text-xs">{saveError}</p>}
                <div className="flex gap-2">
                  <button onClick={saveEdit} disabled={saving} className="btn-primary text-sm py-2 px-5 rounded-xl">
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                  <button onClick={() => setEditing(false)} className="btn-ghost text-sm py-2 px-4 rounded-xl">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Claim / edit actions */}
            {!editing && (
              <div className="flex items-center gap-3 flex-wrap">
                {isOwner && (
                  <button
                    onClick={startEdit}
                    className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors border border-white/10 rounded-lg px-3 py-1.5 hover:border-white/20"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit profile
                  </button>
                )}
                {canClaim && (
                  <button
                    onClick={() => user ? setShowClaim(true) : openAuth('signup')}
                    className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors"
                  >
                    Is this your band? →
                  </button>
                )}
                {claimDone && (
                  <span className="text-xs text-green-400">Claim submitted — we'll be in touch.</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="divider mt-10 mb-6" />

        {/* Gig tabs */}
        <div className="flex gap-1 bg-surface-2 rounded-xl p-1 w-fit mb-6">
          {[['upcoming', `Upcoming (${upcoming.length})`], ['past', `Past (${past.length})`]].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                tab === key ? 'bg-surface-1 text-white shadow' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Gig list */}
        {shown.length > 0 ? (
          <div className="space-y-2.5">
            {shown.map(g => <GigCard key={g.gigId} gig={g} />)}
          </div>
        ) : (
          <div className="bg-surface-2 border border-white/5 rounded-2xl p-12 text-center">
            <span className="text-4xl block mb-3">{tab === 'upcoming' ? '🎸' : '📅'}</span>
            <p className="text-white font-semibold">
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

function Skeleton() {
  return (
    <div className="min-h-screen bg-surface">
      <div className="h-56 sm:h-72 skeleton" />
      <div className="section -mt-20 relative pb-10">
        <div className="flex gap-6 items-start">
          <div className="w-32 h-32 skeleton rounded-2xl flex-shrink-0" />
          <div className="flex-1 pt-4 space-y-3">
            <div className="h-9 skeleton rounded-xl w-56" />
            <div className="h-4 skeleton rounded w-40" />
            <div className="h-4 skeleton rounded w-full max-w-lg" />
          </div>
        </div>
        <div className="divider mt-10 mb-6" />
        <div className="space-y-2.5">
          {[1,2,3].map(i => <div key={i} className="h-20 skeleton rounded-2xl" />)}
        </div>
      </div>
    </div>
  );
}
