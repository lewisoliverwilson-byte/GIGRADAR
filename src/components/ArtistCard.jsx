import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import FollowButton from './FollowButton.jsx';
import { artistColor } from '../utils/format.js';

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
    <div className="group overflow-hidden relative aspect-square bg-zinc-950">
      <Link href={`/artists/${artist.artistId}`} className="block w-full h-full">
        {imgUrl ? (
          <img src={imgUrl} alt={artist.name}
            className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: color + '22' }}>
            <span className="font-display text-5xl" style={{ color }}>{artist.name?.[0]?.toUpperCase()}</span>
          </div>
        )}

        {/* Bottom overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

        <div className="absolute bottom-0 left-0 right-0 p-2.5">
          <p className="font-display text-lg leading-tight text-white truncate">{artist.name}</p>
          {artist.genres?.length > 0 && (
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 truncate">{artist.genres[0]}</p>
          )}
          {artist.upcoming > 0 && (
            <span className="inline-block text-[9px] font-black uppercase tracking-widest bg-white text-black px-1.5 py-0.5 mt-1">
              {artist.upcoming} {artist.upcoming === 1 ? 'gig' : 'gigs'}
            </span>
          )}
        </div>
      </Link>

      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <FollowButton artistId={artist.artistId} size="sm" />
      </div>
    </div>
  );
}
