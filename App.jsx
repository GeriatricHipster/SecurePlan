import React, { useMemo, useState } from 'react';
import HomeDashboard from './components/HomeDashboard.jsx';
import StreamlinedSiteBrowser from './components/StreamlinedSiteBrowser.jsx';

export default function App() {
  const [page, setPage] = useState('home');

  const stats = useMemo(() => ({
    sites: 0,
    surveys: 0,
    devices: 0,
    issues: 0,
  }), []);

  return (
    <div>
      <header className="border-b border-slate-200 bg-white p-3 shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="font-semibold text-slate-900">SecurePlan</div>
          <nav className="flex gap-2">
            <button onClick={() => setPage('home')} className="rounded-lg px-3 py-2 text-sm">Home</button>
            <button onClick={() => setPage('sites')} className="rounded-lg px-3 py-2 text-sm">Sites</button>
            <button onClick={() => setPage('team')} className="rounded-lg px-3 py-2 text-sm">Team</button>
          </nav>
        </div>
      </header>

      {page === 'home' && <HomeDashboard navigate={setPage} stats={stats} />}
      {page === 'sites' && (
        <main className="p-4">
          <StreamlinedSiteBrowser sites={[]} onOpenSite={() => {}} onOpenSurvey={() => {}} />
        </main>
      )}
      {page === 'team' && <main className="p-4">Team page goes here</main>}
    </div>
  );
}
