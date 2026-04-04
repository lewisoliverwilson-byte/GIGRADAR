import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import FollowButton from './FollowButton.jsx';
import { artistInitials, artistColor } from '../utils/format.js';

const imageCache = {};

async function fetchWikiImage(wikipedia) {
  if (!wikipedia) return null;
  if (imageCache[wikipedia] !== undefined) return imageCache[wikipedia];
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikipedia)}`
    );
    const data = await res.json();
    const url = data?.thumbnail?.source || null;
    imageCache[wikipedia] = url;
    return url;
  } catch {
    imageCache[wikipedia] = null;
    return null;
  }
}

export default function ArtistCard({ artist }) {
  const [imgUrl, setImgUrl] = useState(null);
  const color = artist.color || artistColor(artist.artistId);

  useEffect(() => {
    if (artist.imageUrl) { setImgUrl(artist.imageUrl); return; }
    if (artist.wikipedia) fetchWikiImage(artist.wikipedia).then(setImgUrl);
  }, [artist.imageUrl, artist.wikipedia]);

  return (
    <div className="card group hover:border-white/10 transition-all hover:-translate-y-0.5 duration-200">
      {/* Avatar */}
      <Link to={`/artists/${artist.artistId}`} className="block">
        <div className="relative aspect-square overflow-hidden" style={{ background: color + '33' }}>
          {imgUrl ? (
            <img src={imgUrl} alt={artist.name} className="w-full h-full object-cover object-top" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-4xl font-bold" style={{ color }}>{artistInitials(artist.name)}</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        </div>
      </Link>

      {/* Info */}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2 mb-1">
          <Link to={`/artists/${artist.artistId}`} className="font-semibold text-sm text-white hover:text-brand-light truncate transition-colors flex items-center gap-1">
            {artist.name}
            {artist.verified && (
              <svg className="w-3.5 h-3.5 text-brand flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            )}
          </Link>
          <FollowButton artistId={artist.artistId} size="sm" />
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {artist.upcoming > 0 && (
            <span className="text-brand-light font-medium">{artist.upcoming} upcoming</span>
          )}
          {artist.genres?.length > 0 && (
            <span className="truncate">{artist.genres[0]}</span>
          )}
        </div>
      </div>
    </div>
  );
}
