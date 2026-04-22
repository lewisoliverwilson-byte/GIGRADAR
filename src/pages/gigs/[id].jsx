import Head from 'next/head';
import GigDetail from '../../views/GigDetail.jsx';
import { CONFIG } from '../../utils/config.js';

export default function GigPage({ gig }) {
  const artistName = gig?.artistName || (gig?.artistId || '').replace(/-/g, ' ');
  const venueName  = gig?.venueName  || 'UK';
  const date       = gig?.date       || '';
  const dateFormatted = date ? new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const title = gig
    ? `${artistName} at ${venueName}${gig.venueCity ? `, ${gig.venueCity}` : ''}${dateFormatted ? ` — ${dateFormatted}` : ''} · GigRadar`
    : 'Gig — GigRadar';
  const desc = gig
    ? `${artistName} live at ${venueName}${gig.venueCity ? `, ${gig.venueCity}` : ''}${dateFormatted ? ` on ${dateFormatted}` : ''}. Compare ticket prices and get alerts on GigRadar.`
    : 'Find tickets for this gig on GigRadar.';

  const cheapestTicket = gig?.tickets?.length
    ? gig.tickets.reduce((best, t) => {
        const p = parseFloat((t.price || '').replace(/[^0-9.]/g, ''));
        const b = parseFloat((best.price || '').replace(/[^0-9.]/g, ''));
        return (!isNaN(p) && (isNaN(b) || p < b)) ? t : best;
      }, gig.tickets[0])
    : null;

  const jsonLd = gig ? {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: `${artistName} at ${venueName}`,
    startDate: date,
    eventStatus: gig.isSoldOut
      ? 'https://schema.org/EventCancelled'
      : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'MusicVenue',
      name: venueName,
      address: {
        '@type': 'PostalAddress',
        addressLocality: gig.venueCity || '',
        addressCountry: 'GB',
      },
    },
    performer: {
      '@type': 'MusicGroup',
      name: artistName,
    },
    ...(cheapestTicket ? {
      offers: {
        '@type': 'Offer',
        url: cheapestTicket.url,
        priceCurrency: 'GBP',
        price: parseFloat((cheapestTicket.price || '0').replace(/[^0-9.]/g, '')) || undefined,
        availability: gig.isSoldOut
          ? 'https://schema.org/SoldOut'
          : 'https://schema.org/InStock',
        validFrom: new Date().toISOString(),
      },
    } : {}),
    organizer: {
      '@type': 'Organization',
      name: 'GigRadar',
      url: 'https://gigradar.co.uk',
    },
  } : null;

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
        {gig?.gigId && (
          <link rel="canonical" href={`https://gigradar.co.uk/gigs/${gig.gigId}`} />
        )}
        {jsonLd && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
          />
        )}
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
