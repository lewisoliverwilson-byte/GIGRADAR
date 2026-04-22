import Head from 'next/head';
import Calendar from '../views/Calendar.jsx';

export default function CalendarPage() {
  return (
    <>
      <Head>
        <title>Gig Calendar — GigRadar</title>
        <meta name="description" content="Browse UK gigs by date. See every live music event this month across every city and genre." />
        <meta property="og:title" content="Gig Calendar — GigRadar" />
        <meta property="og:description" content="Browse UK gigs by date. See every live music event this month across every city and genre." />
        <meta name="twitter:card" content="summary" />
      </Head>
      <Calendar />
    </>
  );
}
