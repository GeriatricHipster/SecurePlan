const TYPE_LABELS = {
  automatic_door_operator: 'ADO',
  biometric_reader: 'BIO',
  card_reader: 'CR',
  door_position: 'DPS',
  double_door: 'DD',
  electric_exit_device: 'EED',
  electric_lockset: 'EL',
  electric_strike: 'ES',
  handicap_push_button: 'ADA',
  network_patch_panel: 'PP',
  network_switch: 'SW',
  request_to_exit: 'REX',
  single_door: 'SD',
};

function svgData(label) {
  const safe = String(label || '?').slice(0, 3).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#f8fafc" stroke="#cbd5e1"/><text x="32" y="38" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="#0f172a">${safe}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export const REPORT_ICON_DATA = Object.fromEntries(
  Object.entries(TYPE_LABELS).map(([key, label]) => [key, svgData(label)])
);
