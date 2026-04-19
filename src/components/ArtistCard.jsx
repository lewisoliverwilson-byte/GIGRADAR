import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import FollowButton from './FollowButton.jsx';
import { artistInitials, artistColor } from '../utils/format.js';

const imageCache = {};
async function fetchWikiImage(wikipedia) {
  if (!wikipedia) return null;
  if (imageCache[wikipedia] !== undefined) return imageCache[wikipedia];
  try {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikipedia)}`);
    const data = await res.json();
    imageCache[wikipedia] = data?.thumbnail?.source || null;
    return imageCache[wikipedia];
  } catch { imageCache[wikipedia] = null; return null; }
}

export default function ArtistCard({ artist }) {
  const [imgUrl, setImgUrl] = useState(null);
  const color = artist.color || artistColor(artist.artistId);

  useEffect(() => {
    if (artist.imageUrl) { setImgUrl(artist.imageUrl); return; }
    if (artist.wikipedia) fetchWikiImage(artist.wikipedia).then(setImgUrl);
  }, [artist.imageUrl, artist.wikipedia]);

  return (
    <div className="group rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 hover:border-zinc-600 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/50">
      <Link href={`/artists/${artist.artistId}`} className="block">
        <div className="relative aspect-square overflow-hidden" style={{ backgroundColor: color + '33' }}>
          {imgUrl ? (
            <img src={imgUrl} alt={artist.name}
              className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-500" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-4xl font-black" style={{ color }}>{artistInitials(artist.name)}</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
          {artist.upcoming > 0 && (
            <div className="absolute bottom-2 left-2">
              <span className="inline-flex items-center gap-1 bg-violet-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-md">
                {artist.upcoming} {artist.upcoming === 1 ? 'gig' : 'gigs'}
              </span>
            </div>
          )}
        </div>
      </Link>
      <div className="p-3 bg-zinc-900">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/artists/${artist.artistId}`}
            className="font-semibold text-sm text-white hover:text-violet-400 truncate transition-colors leading-tight">
            {artist.name}
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
