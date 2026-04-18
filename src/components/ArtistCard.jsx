import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import FollowButton from './FollowButton.jsx';
import { artistInitials, artistColor } from '../utils/format.js';

const imageCache = {};

async function fetchWikiImage(wikipedia) {
  if (!wikipedia) return null;
  if (imageCache[wikipedia] !== undefined) return imageCache[wikipedia];
  try {
    const res  = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikipedia)}`);
    const data = await res.json();
    const url  = data?.thumbnail?.source || null;
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
    if (artist.imageUrl)  { setImgUrl(artist.imageUrl); return; }
    if (artist.wikipedia) fetchWikiImage(artist.wikipedia).then(setImgUrl);
  }, [artist.imageUrl, artist.wikipedia]);

  return (
    <div className="card-hover group">
      {/* Image */}
      <Link href={`/artists/${artist.artistId}`} className="block">
        <div className="relative aspect-square overflow-hidden" style={{ background: color + '22' }}>
          {imgUrl ? (
            <img
              src={imgUrl}
              alt={artist.name}
              className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-5xl font-black" style={{ color }}>{artistInitials(artist.name)}</span>
            </div>
          )}
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />

          {/* Gig count badge */}
          {artist.upcoming > 0 && (
            <div className="absolute bottom-2.5 left-2.5">
              <span className="badge-brand text-xs">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {artist.upcoming} {artist.upcoming === 1 ? 'gig' : 'gigs'}
              </span>
            </div>
          )}
        </div>
      </Link>

      {/* Info */}
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/artists/${artist.artistId}`}
            className="font-semibold text-sm text-white hover:text-brand-light truncate transition-colors flex items-center gap-1 min-w-0">
            <span className="truncate">{artist.name}</span>
            {artist.verified && (
              <svg className="w-3.5 h-3.5 text-brand flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            )}
          </Link>
          <FollowButton artistId={artist.artistId} size="sm" />
        </div>
        {artist.genres?.length > 0 && (
          <p className="text-xs text-zinc-500 mt-0.5 truncate">{artist.genres[0]}</p>
        )}
      </div>
    </div>
  );
}
