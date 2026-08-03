import React from 'react';
import { elementSymbol } from './deviceLibrary.js';

const DOOR_PATHS = {
  single_door: <><path d="M5 3v18M5 21h16M5 21A16 16 0 0 1 21 5" /></>,
  double_door: <><path d="M12 21V5M12 21H3M12 21h9M12 21A9 9 0 0 0 3 12M12 21a9 9 0 0 1 9-9" /></>,
  sliding_door: <><rect x="3" y="7" width="8" height="11" /><rect x="13" y="7" width="8" height="11" /><path d="M5 21h14M8 4l-3 3 3 3M16 4l3 3-3 3" /></>,
  overhead_door: <><rect x="4" y="3" width="16" height="18" /><path d="M4 7h16M4 11h16M4 15h16M4 19h16" /></>,
  hatch: <><rect x="4" y="4" width="16" height="16" /><path d="M4 4l16 16M20 4L4 20" /></>,
  folding_door: <><path d="M3 19V5l5 14 5-14 4 14 4-14" /></>,
  revolving_door: <><circle cx="12" cy="12" r="9" /><path d="M12 3v18M3 12h18" /></>,
  gate: <><path d="M3 4v16M21 4v16M3 7h18M3 17h18M7 7l10 10M17 7L7 17" /></>,
  turnstile: <><circle cx="12" cy="12" r="3" /><path d="M12 3v6M12 15v6M3 12h6M15 12h6M5.6 5.6l4.2 4.2M14.2 14.2l4.2 4.2" /></>,
};

const CAMERA_PATHS = {
  fixed_camera: <><path d="M4 8h11l5 4-5 4H4zM8 16l-2 5" /><circle cx="14" cy="12" r="2" /></>,
  dome_camera: <><path d="M4 12h16M6 12a6 6 0 0 0 12 0" /><circle cx="12" cy="15" r="2" /></>,
  ptz_camera: <><path d="M5 10h14M7 10a5 5 0 0 0 10 0M12 15v5M8 20h8" /><circle cx="12" cy="13" r="2" /></>,
  multisensor_camera: <><circle cx="12" cy="12" r="9" /><circle cx="8" cy="9" r="2" /><circle cx="16" cy="9" r="2" /><circle cx="12" cy="16" r="2" /></>,
  lpr_camera: <><path d="M3 8h13l5 4-5 4H3z" /><rect x="6" y="10" width="8" height="4" /></>,
};

export default function DeviceGlyph({ type, symbol, label, iconSrc }) {
  if (iconSrc) return <img className="device-glyph-image" src={iconSrc} alt="" draggable="false" aria-hidden="true" />;
  const paths = DOOR_PATHS[type] || CAMERA_PATHS[type];
  if (!paths) return <span>{symbol || elementSymbol({ type, label, metadata: { symbol } })}</span>;
  return <svg className="device-glyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">{paths}</svg>;
}
