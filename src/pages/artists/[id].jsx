import Head from 'next/head';
import ArtistDetail from '../../views/ArtistDetail.jsx';
import { CONFIG } from '../../utils/config.js';

export default function ArtistPage({ artist }) {
  const title = artist ? `${artist.name} — GigRadar` : 'Artist — GigRadar';
  const desc  = artist
    ? `Upcoming gigs for ${artist.name}${artist.genres?.length ? ` (${artist.genres[0]})` : ''}. Find tickets and get alerts on GigRadar.`
    : 'Find upcoming gigs for this artist on GigRadar.';

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
