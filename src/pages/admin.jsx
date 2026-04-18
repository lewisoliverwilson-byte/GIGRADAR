import dynamic from 'next/dynamic';

const Admin = dynamic(() => import('../views/Admin.jsx'), { ssr: false });
export default Admin;
