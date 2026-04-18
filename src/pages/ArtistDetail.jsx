import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../utils/api.js';
import { getToken } from '../utils/cognito.js';
import { artistInitials, artistColor, formatDate } from '../utils/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import FollowButton from '../components/FollowButton.jsx';
import AlertButton from '../components/AlertButton.jsx';
import GigCard from '../components/GigCard.jsx';
import ClaimModal from '../components/ClaimModal.jsx';

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
  const { id }       = useParams();
  const { user, openAuth } = useAuth();

  const [artist, setArtist]   = useState(null);
  const [gigs, setGigs]       = useState([]);
  const [imgUrl, setImgUrl]   = useState(null);
  const [tab, setTab]         = useState('upcoming');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  const [showClaim, setShowClaim] = useState(false);
  const [claimDone, setClaimDone] = useState(false);

  const [editing, setEditing]   = useState(false);
  const [editData, setEditData] = useState({});
  const [saving, setSaving]     = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    setLoading(true); setError(false);
    Promise.all([api.getArtist(id), api.getArtistGigs(id)])
      .then(([a, g]) => { setArtist(a); setGigs(g); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!artist) return;
    const src = artist.imageUrl || null;
    if (src) { setImgUrl(src); return; }
    fetchWikiImage(artist.wikipedia).then(setImgUrl);
  }, [artist]);

  function startEdit() {
    setEditData({
      bio:      artist.bio      || '',
      imageUrl: artist.imageUrl || '',
      website:  artist.website  || '',
      spotify:  artist.spotify  || '',
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
      // Only send changed fields
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
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <p className="text-gray-400 mb-4">Artist not found.</p>
      <Link to="/artists" className="text-brand hover:underline">← Back to artists</Link>
    </div>
  );

  const today      = new Date().toISOString().split('T')[0];
  const upcoming   = gigs.filter(g => g.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past       = gigs.filter(g => g.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const shown      = tab === 'upcoming' ? upcoming : past;
  const color      = artist.color || artistColor(artist.artistId);
  const isClaimed  = !!artist.claimedBy;
  const isOwner    = user && artist.claimedBy === user.sub;
  const canClaim   = !isClaimed && !claimDone;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* Hero */}
      <div className="card overflow-hidden mb-8">
        <div className="relative h-48 sm:h-64" style={{ background: `${color}22` }}>
          {imgUrl && (
            <img src={imgUrl} alt={artist.name}
              className="w-full h-full object-cover object-top opacity-40" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-surface-1 via-surface-1/40 to-transparent" />
        </div>
        <div className="px-6 pb-6 -mt-16 relative">
          {/* Avatar */}
          <div className="w-24 h-24 rounded-2xl border-4 border-surface-1 overflow-hidden mb-4 shadow-xl"
            style={{ background: color + '33' }}>
            {imgUrl
              ? <img src={imgUrl} alt={artist.name} className="w-full h-full object-cover object-top" />
              : <div className="w-full h-full flex items-center justify-center text-3xl font-bold" style={{ color }}>
                  {artistInitials(artist.name)}
                </div>
            }
          </div>

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              {/* Name + verified */}
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-3xl font-extrabold">{artist.name}</h1>
                {artist.verified && (
                  <span className="flex items-center gap-1 bg-brand/15 text-brand text-xs font-medium px-2 py-0.5 rounded-full border border-brand/30">
                    <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Verified artist
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 mt-1 text-sm text-gray-400 flex-wrap">
                {artist.genres?.slice(0, 3).map(g => (
                  <span key={g} className="bg-surface-3 px-2 py-0.5 rounded text-xs">{g}</span>
                ))}
                {artist.monthlyListeners > 0 && (
                  <span>{artist.monthlyListeners.toLocaleString()} listeners</span>
                )}
                {artist.lastfmRank && (
                  <span className="text-gray-500">#{artist.lastfmRank} in UK</span>
                )}
              </div>

              {/* Bio */}
              {!editing && artist.bio && (
                <p className="text-gray-400 text-sm mt-3 max-w-2xl leading-relaxed">{artist.bio}</p>
              )}

              {/* Social links */}
              {!editing && (
                <div className="flex items-center gap-3 mt-3 flex-wrap">
                  {artist.website && (
                    <a href={artist.website} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-gray-500 hover:text-white transition-colors">Website ↗</a>
                  )}
                  {artist.spotify && (
                    <a href={artist.spotify} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-gray-500 hover:text-white transition-colors">Spotify ↗</a>
                  )}
                  {artist.instagram && (
                    <a href={artist.instagram} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-gray-500 hover:text-white transition-colors">Instagram ↗</a>
                  )}
                  {artist.facebook && (
                    <a href={artist.facebook} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-gray-500 hover:text-white transition-colors">Facebook ↗</a>
                  )}
                </div>
              )}

              {/* Edit form */}
              {editing && (
                <div className="mt-4 space-y-3 max-w-lg">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Bio</label>
                    <textarea
                      value={editData.bio}
                      onChange={e => setEditData(d => ({ ...d, bio: e.target.value }))}
                      rows={3}
                      className="input w-full resize-none text-sm"
                      placeholder="Tell people about the band…"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Photo URL</label>
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
                        <label className="block text-xs text-gray-500 mb-1">{label}</label>
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
                    <button onClick={saveEdit} disabled={saving} className="btn-primary text-sm py-1.5 px-4">
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => setEditing(false)} className="btn-ghost text-sm py-1.5 px-4">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Claim / edit actions */}
              {!editing && (
                <div className="mt-3 flex items-center gap-3 flex-wrap">
                  {isOwner && (
                    <button onClick={startEdit}
                      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors border border-white/10 rounded-lg px-2.5 py-1.5 hover:border-white/20">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Edit profile
                    </button>
                  )}
                  {canClaim && (
                    <button
                      onClick={() => user ? setShowClaim(true) : openAuth('signup')}
                      className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
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

            <div className="flex flex-col items-end gap-2">
              <FollowButton artistId={artist.artistId} />
              <AlertButton
                targetId={artist.artistId}
                targetType="artist"
                targetName={artist.name}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Gig tabs */}
      <div className="flex gap-1 bg-surface-2 rounded-lg p-1 w-fit mb-5">
        {[['upcoming', `Upcoming (${upcoming.length})`], ['past', `Past (${past.length})`]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === key ? 'bg-surface-1 text-white shadow' : 'text-gray-400 hover:text-white'
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
        <div className="card p-10 text-center text-gray-500 text-sm">
          {tab === 'upcoming' ? 'No upcoming gigs found.' : 'No past gigs on record.'}
        </div>
      )}

      {showClaim && (
        <ClaimModal
          artist={artist}
          onClose={() => setShowClaim(false)}
          onSuccess={() => { setShowClaim(false); setClaimDone(true); }}
        />
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 animate-pulse">
      <div className="card overflow-hidden mb-8">
        <div className="h-48 bg-surface-2" />
        <div className="px-6 pb-6 pt-4 space-y-3">
          <div className="h-8 bg-surface-3 rounded w-48" />
          <div className="h-4 bg-surface-2 rounded w-32" />
        </div>
      </div>
      <div className="space-y-2">
        {[1,2,3].map(i => <div key={i} className="h-20 bg-surface-2 rounded-xl" />)}
      </div>
    </div>
  );
}
