import Head from 'next/head';
import Profile from '../views/Profile.jsx';

export default function ProfilePage() {
  return (
    <>
      <Head>
        <title>Profile — GigRadar</title>
        <meta name="description" content="Manage your GigRadar profile, followed artists and gig alerts." />
      </Head>
      <Profile />
    </>
  );
}
