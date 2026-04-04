import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../utils/api.js';
import { artistInitials, artistColor, formatDate } from '../utils/format.js';
import FollowButton from '../components/FollowButton.jsx';
import GigCard from '../components/GigCard.jsx';

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
  const { id } = useParams();
  const [artist, setArtist] = useState(null);
  const [gigs, setGigs]     = useState([]);
  const [imgUrl, setImgUrl] = useState(null);
  const [tab, setTab]       = useState('upcoming');
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(false);

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

  if (loading) return <Skeleton />;
  if (error || !artist) return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <p className="text-gray-400 mb-4">Artist not found.</p>
      <Link to="/artists" className="text-brand hover:underline">← Back to artists</Link>
    </div>
  );

  const today    = new Date().toISOString().split('T')[0];
  const upcoming = gigs.filter(g => g.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past     = gigs.filter(g => g.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const shown    = tab === 'upcoming' ? upcoming : past;
  const color    = artist.color || artistColor(artist.artistId);

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
            <div>
              <h1 className="text-3xl font-extrabold">{artist.name}</h1>
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
              {artist.bio && <p className="text-gray-400 text-sm mt-3 max-w-2xl leading-relaxed">{artist.bio}</p>}
            </div>
            <FollowButton artistId={artist.artistId} />
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
