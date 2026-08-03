export const DEVICE_CATEGORIES = [
  {
    id: 'access_control',
    name: 'Access Control',
    short: 'AC',
    color: '#b4232d',
    items: [
      { type: 'card_reader', label: 'Card Reader', symbol: 'CR' },
      { type: 'door_position', label: 'Door Position Switch', symbol: 'DPS' },
      { type: 'request_to_exit', label: 'Request to Exit', symbol: 'REX' },
      { type: 'door_lock', label: 'Door Lock', symbol: 'DL' },
      { type: 'access_panel', label: 'Access Control Panel', symbol: 'ACP' },
      { type: 'power_supply', label: 'Power Supply', symbol: 'PS' },
    ],
  },
  {
    id: 'cctv',
    name: 'CCTV',
    short: 'CC',
    color: '#1769aa',
    items: [
      { type: 'fixed_camera', label: 'Fixed Camera', symbol: 'CAM' },
      { type: 'dome_camera', label: 'Dome Camera', symbol: 'DOME' },
      { type: 'ptz_camera', label: 'PTZ Camera', symbol: 'PTZ' },
      { type: 'multisensor_camera', label: 'Multisensor Camera', symbol: 'MS' },
      { type: 'lpr_camera', label: 'License Plate Camera', symbol: 'LPR' },
      { type: 'nvr', label: 'Network Video Recorder', symbol: 'NVR' },
    ],
  },
  {
    id: 'intrusion',
    name: 'Intrusion',
    short: 'IN',
    color: '#7c3aed',
    items: [
      { type: 'motion_detector', label: 'Motion Detector', symbol: 'PIR' },
      { type: 'glass_break', label: 'Glass Break Sensor', symbol: 'GB' },
      { type: 'intrusion_contact', label: 'Door/Window Contact', symbol: 'DC' },
      { type: 'keypad', label: 'Intrusion Keypad', symbol: 'KP' },
      { type: 'duress_button', label: 'Duress Button', symbol: 'DB' },
      { type: 'intrusion_panel', label: 'Intrusion Panel', symbol: 'IP' },
    ],
  },
  {
    id: 'doors',
    name: 'Doors',
    short: 'DR',
    color: '#b66a0a',
    items: [
      { type: 'single_door', label: 'Single Door', symbol: 'SD' },
      { type: 'double_door', label: 'Double Door', symbol: 'DD' },
      { type: 'sliding_door', label: 'Sliding Door', symbol: 'SL' },
      { type: 'gate', label: 'Gate', symbol: 'GT' },
      { type: 'turnstile', label: 'Turnstile', symbol: 'TS' },
      { type: 'opening_note', label: 'Opening Note', symbol: 'DN' },
    ],
  },
];

export const MARKUP_TOOLS = [
  { type: 'select', label: 'Select', symbol: '↖' },
  { type: 'line', label: 'Line', symbol: '╱' },
  { type: 'arrow', label: 'Arrow', symbol: '↗' },
  { type: 'rectangle', label: 'Rectangle', symbol: '□' },
  { type: 'ellipse', label: 'Ellipse', symbol: '○' },
  { type: 'text', label: 'Text callout', symbol: 'T' },
];

export const DEFAULT_PROFILE = {
  id: 'full-door-default',
  name: 'Full Door',
  description: 'Card Reader, DPS, REX, and Door Lock',
  builtIn: true,
  components: [
    { category: 'access_control', type: 'card_reader', label: 'Card Reader', symbol: 'CR', offsetX: -0.032, offsetY: 0 },
    { category: 'access_control', type: 'door_position', label: 'Door Position Switch', symbol: 'DPS', offsetX: 0, offsetY: -0.038 },
    { category: 'access_control', type: 'request_to_exit', label: 'Request to Exit', symbol: 'REX', offsetX: 0.032, offsetY: 0 },
    { category: 'access_control', type: 'door_lock', label: 'Door Lock', symbol: 'DL', offsetX: 0, offsetY: 0.038 },
  ],
};

export function categoryFor(id) {
  return DEVICE_CATEGORIES.find((category) => category.id === id);
}

export function itemFor(categoryId, type) {
  return categoryFor(categoryId)?.items.find((item) => item.type === type);
}

export function elementSymbol(element) {
  return element.metadata?.symbol || itemFor(element.category, element.type)?.symbol || element.label?.slice(0, 3).toUpperCase() || '?';
}

export function elementColor(element) {
  return element.color || categoryFor(element.category)?.color || '#46545f';
}
