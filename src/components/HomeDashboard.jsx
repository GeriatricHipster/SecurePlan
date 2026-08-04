import React from 'react';

function Tile({ title, value, note }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-medium text-slate-500">{title}</div>
      <div className="mt-2 text-3xl font-semibold text-slate-900">{value}</div>
      {note ? <div className="mt-1 text-sm text-slate-500">{note}</div> : null}
    </div>
  );
}

function Action({ title, description, buttonText, onClick }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <div className="text-base font-semibold text-slate-900">{title}</div>
      <div className="mt-2 text-sm text-slate-600">{description}</div>
      <button
        type="button"
        onClick={onClick}
        className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
      >
        {buttonText}
      </button>
    </div>
  );
}

export default function HomeDashboard({ user, navigate, stats = {} }) {
  return (
    <main id="main-content" className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl bg-slate-900 p-6 text-white shadow-lg">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-300">SecurePlan</p>
            <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Command Center</h1>
            <p className="mt-3 text-sm text-slate-300 sm:text-base">
              A simple starting point for leadership to review sites, surveys, progress, and team activity.
            </p>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Tile title="Sites" value={stats.sites ?? 0} note="Open locations" />
          <Tile title="Surveys" value={stats.surveys ?? 0} note="Active survey folders" />
          <Tile title="Plotted Devices" value={stats.devices ?? 0} note="Items on plans" />
          <Tile title="Open Issues" value={stats.issues ?? 0} note="Needs review" />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Action
            title="Open Site Plans"
            description="Go directly into sites and surveys with the streamlined browser."
            buttonText="Open Sites"
            onClick={() => navigate('sites')}
          />
          <Action
            title="Team and Invitations"
            description="Manage users, roles, and invitation codes from one place."
            buttonText="Open Team"
            onClick={() => navigate('team')}
          />
        </section>
      </div>
    </main>
  );
}
