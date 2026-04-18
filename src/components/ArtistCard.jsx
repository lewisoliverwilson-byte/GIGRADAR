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
    const url = data?.thumbnail?.source || null;
    imageCache[wikipedia] = url;
    return url;
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
    <div className="group rounded-2xl overflow-hidden bg-white/4 border border-white/5 hover:border-white/15 transition-all duration-200 hover:-translate-y-0.5">
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
              <span className="text-4xl font-black" style={{ color }}>{artistInitials(artist.name)}</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
          {artist.upcoming > 0 && (
            <div className="absolute bottom-2 left-2">
              <span className="inline-flex items-center gap-1 bg-violet-600/90 text-white text-[10px] font-semibold px-2 py-0.5 rounded-md">
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {artist.upcoming}
              </span>
            </div>
          )}
        </div>
      </Link>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/artists/${artist.artistId}`} className="font-semibold text-sm text-white hover:text-violet-300 truncate transition-colors leading-tight">
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
