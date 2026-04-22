import Head from 'next/head';
import GigDetail from '../../views/GigDetail.jsx';
import { CONFIG } from '../../utils/config.js';

export default function GigPage({ gig }) {
  const artistName = gig?.artistName || (gig?.artistId || '').replace(/-/g, ' ');
  const venueName  = gig?.venueName  || 'UK';
  const date       = gig?.date       || '';
  const title      = gig ? `${artistName} at ${venueName}${date ? ` — ${date}` : ''} — GigRadar` : 'Gig — GigRadar';
  const desc       = gig
    ? `${artistName} live at ${venueName}${gig.venueCity ? `, ${gig.venueCity}` : ''}${date ? ` on ${date}` : ''}. Get tickets on GigRadar.`
    : 'Find tickets for this gig on GigRadar.';

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={desc} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={desc} />
        <meta property="og:type" content="event" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={desc} />
      </Head>
      <GigDetail gig={gig} />
    </>
  );
}

export async function getStaticPaths() {
  return { paths: [], fallback: 'blocking' };
}

export async function getStaticProps({ params }) {
  try {
    const res = await fetch(`${CONFIG.apiBaseUrl}/gigs/${encodeURIComponent(params.id)}`);
    if (!res.ok) return { props: { gig: null }, revalidate: 3600 };
    const gig = await res.json();
    return { props: { gig }, revalidate: 3600 };
  } catch {
    return { props: { gig: null }, revalidate: 3600 };
  }
}
