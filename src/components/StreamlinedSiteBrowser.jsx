import React, { useEffect, useMemo, useState } from 'react';

function SiteCard({ site, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border p-4 text-left transition ${
        selected
          ? 'border-blue-500 bg-blue-50 shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <div className="text-sm font-semibold text-slate-900">{site.name}</div>
      <div className="mt-1 text-xs text-slate-500">
        {site.address || 'No address'} · {site.surveys?.length || 0} surveys
      </div>
    </button>
  );
}

function SurveyRow({ survey, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-blue-300 hover:bg-blue-50"
    >
      <div className="text-sm font-semibold text-slate-900">{survey.name}</div>
      <div className="mt-1 text-xs text-slate-500">
        {survey.description || 'Open survey'}
      </div>
    </button>
  );
}

export default function StreamlinedSiteBrowser({ sites = [], onOpenSite, onOpenSurvey }) {
  const [query, setQuery] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState(sites[0]?.id || '');

  useEffect(() => {
    if (!selectedSiteId && sites[0]?.id) setSelectedSiteId(sites[0].id);
  }, [selectedSiteId, sites]);

  const filteredSites = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sites;

    return sites.filter((site) => {
      const siteMatch = site.name?.toLowerCase().includes(q);
      const surveyMatch = (site.surveys || []).some((survey) =>
        survey.name?.toLowerCase().includes(q)
      );
      return siteMatch || surveyMatch;
    });
  }, [query, sites]);

  const selectedSite = filteredSites.find((site) => site.id === selectedSiteId) || filteredSites[0] || null;

  return (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Sites</h2>
          <p className="text-sm text-slate-500">Search a site or survey</p>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sites and surveys"
          className="mb-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:bg-white"
        />

        <div className="space-y-3">
          {filteredSites.map((site) => (
            <SiteCard
              key={site.id}
              site={site}
              selected={site.id === selectedSite?.id}
              onClick={() => {
                setSelectedSiteId(site.id);
                onOpenSite?.(site);
              }}
            />
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Surveys</h2>
            <p className="text-sm text-slate-500">
              {selectedSite ? `Inside ${selectedSite.name}` : 'Pick a site to continue'}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {selectedSite?.surveys?.length ? (
            selectedSite.surveys.map((survey) => (
              <SurveyRow
                key={survey.id}
                survey={survey}
                onClick={() => onOpenSurvey?.(selectedSite, survey)}
              />
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">
              No surveys to show.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
