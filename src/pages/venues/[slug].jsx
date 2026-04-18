import Head from 'next/head';
import VenuePage from '../../views/VenuePage.jsx';
import { CONFIG } from '../../utils/config.js';

export default function VenueRoute({ venue }) {
  const title = venue ? `${venue.name}${venue.city ? `, ${venue.city}` : ''} — GigRadar` : 'Venue — GigRadar';
  const desc  = venue
    ? `Upcoming gigs at ${venue.name}${venue.city ? ` in ${venue.city}` : ''}. Find tickets and get alerts on GigRadar.`
    : 'Find upcoming gigs at this venue on GigRadar.';

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={desc} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={desc} />
        {(venue?.photoUrl || venue?.imageUrl) && (
          <meta property="og:image" content={venue.photoUrl || venue.imageUrl} />
        )}
        <meta property="og:type" content="place" />
      </Head>
      <VenuePage />
    </>
  );
}

export async function getServerSideProps({ params }) {
  try {
    const res = await fetch(`${CONFIG.apiBaseUrl}/venues/${encodeURIComponent(params.slug)}`);
    if (!res.ok) return { props: { venue: null } };
    const venue = await res.json();
    return { props: { venue } };
  } catch {
    return { props: { venue: null } };
  }
}
