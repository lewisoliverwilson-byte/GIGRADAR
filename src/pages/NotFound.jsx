import React from 'react';
import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="max-w-xl mx-auto px-4 py-24 text-center">
      <p className="text-6xl font-black text-surface-3 mb-4">404</p>
      <h1 className="text-xl font-bold mb-2">Page not found</h1>
      <p className="text-gray-400 text-sm mb-6">That page doesn't exist.</p>
      <Link to="/" className="btn-primary px-6">Go home</Link>
    </div>
  );
}
