import Head from 'next/head';
import ArtistDetail from '../../views/ArtistDetail.jsx';
import { CONFIG } from '../../utils/config.js';

export default function ArtistPage({ artist }) {
  const title = artist
    ? `${artist.name} Tickets & Upcoming Gigs — GigRadar`
    : 'Artist — GigRadar';
  const desc = artist
    ? `${artist.name} has ${artist.upcoming || 0} upcoming UK gig${artist.upcoming !== 1 ? 's' : ''}${artist.genres?.length ? ` — ${artist.genres[0]}` : ''}. Get tickets and instant alerts on GigRadar.`
    : 'Find upcoming gigs for this artist on GigRadar.';

  const jsonLd = artist ? {
    '@context': 'https://schema.org',
    '@type': 'MusicGroup',
    name: artist.name,
    url: `https://gigradar.co.uk/artists/${artist.artistId}`,
    ...(artist.imageUrl ? { image: artist.imageUrl } : {}),
    ...(artist.genres?.length ? { genre: artist.genres } : {}),
    ...(artist.bio ? { description: artist.bio.substring(0, 300) } : {}),
  } : null;

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={desc} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={desc} />
        {artist?.imageUrl && <meta property="og:image" content={artist.imageUrl} />}
        <meta property="og:type" content="profile" />
        <meta name="twitter:card" content={artist?.imageUrl ? 'summary_large_image' : 'summary'} />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={desc} />
        {artist?.imageUrl && <meta name="twitter:image" content={artist.imageUrl} />}
        {artist?.artistId && (
          <link rel="canonical" href={`https://gigradar.co.uk/artists/${artist.artistId}`} />
        )}
        {jsonLd && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
          />
        )}
      </Head>
      <ArtistDetail initialArtist={artist} />
    </>
  );
}

export async function getStaticPaths() {
  return { paths: [], fallback: 'blocking' };
}

export async function getStaticProps({ params }) {
  try {
    const res = await fetch(`${CONFIG.apiBaseUrl}/artists/${encodeURIComponent(params.id)}`);
    if (!res.ok) return { props: { artist: null }, revalidate: 3600 };
    const artist = await res.json();
    return { props: { artist }, revalidate: 3600 };
  } catch {
    return { props: { artist: null }, revalidate: 3600 };
  }
}
