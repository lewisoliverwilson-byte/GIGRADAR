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
      </Head>
      <ArtistDetail />
    </>
  );
}

export async function getServerSideProps({ params }) {
  try {
    const res = await fetch(`${CONFIG.apiBaseUrl}/artists/${encodeURIComponent(params.id)}`);
    if (!res.ok) return { props: { artist: null } };
    const artist = await res.json();
    return { props: { artist } };
  } catch {
    return { props: { artist: null } };
  }
}
