import React, { useId } from 'react';
import { DEFAULT_ICON_COLOR, elementSymbol } from './deviceLibrary.js';

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

function rgbFor(color) {
  const match = /^#([0-9a-f]{6})$/i.exec(color || '');
  const value = Number.parseInt(match?.[1] || DEFAULT_ICON_COLOR.slice(1), 16);
  return { red: ((value >> 16) & 255) / 255, green: ((value >> 8) & 255) / 255, blue: (value & 255) / 255 };
}

export default function DeviceGlyph({ type, symbol, label, iconSrc, color = DEFAULT_ICON_COLOR }) {
  const generatedId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const outlineColor = color || DEFAULT_ICON_COLOR;

  if (iconSrc) {
    const filterId = `report-icon-${generatedId}`;
    const rgb = rgbFor(color);
    return (
      <svg className="device-glyph device-glyph--report" viewBox="0 0 72 72" aria-hidden="true">
        <defs>
          <filter id={filterId} colorInterpolationFilters="sRGB">
            <feColorMatrix in="SourceGraphic" type="saturate" values="0" result="gray" />
            <feComponentTransfer in="gray">
              <feFuncR type="linear" slope={1 - rgb.red} intercept={rgb.red} />
              <feFuncG type="linear" slope={1 - rgb.green} intercept={rgb.green} />
              <feFuncB type="linear" slope={1 - rgb.blue} intercept={rgb.blue} />
            </feComponentTransfer>
          </filter>
        </defs>
        <rect x="5" y="5" width="62" height="62" rx="12" fill="none" stroke={outlineColor} strokeWidth="2.5" />
        <image className="device-glyph-image" href={iconSrc} width="72" height="72" filter={`url(#${filterId})`} draggable="false" />
      </svg>
    );
  }

  const paths = DOOR_PATHS[type] || CAMERA_PATHS[type];
  if (!paths) {
    const fallbackText = symbol || elementSymbol({ type, label, metadata: { symbol } });
    return (
      <svg className="device-glyph device-glyph--fallback" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="none" stroke={outlineColor} strokeWidth="1.8" />
        <text
          x="12"
          y="15"
          textAnchor="middle"
          fontSize="7.5"
          fontWeight="700"
          fill={outlineColor}
          stroke={outlineColor}
          strokeWidth="0.35"
          paintOrder="stroke fill"
        >
          {fallbackText}
        </text>
      </svg>
    );
  }

  return (
    <svg
      className="device-glyph"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      stroke={outlineColor}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths}
    </svg>
  );
}
