import { REPORT_ICON_DATA } from './reportIcons.js';

export const DEVICE_CATEGORIES = [
  {
    id: 'access_control',
    name: 'Access Control',
    short: 'AC',
    color: '#b4232d',
    items: [
      { type: 'automatic_door_operator', label: 'Automatic Door Operator', symbol: 'ADO', reportIcon: REPORT_ICON_DATA.automatic_door_operator },
      { type: 'biometric_reader', label: 'Biometric Reader', symbol: 'BIO', reportIcon: REPORT_ICON_DATA.biometric_reader },
      { type: 'card_reader', label: 'Card Reader', symbol: 'CR', reportIcon: REPORT_ICON_DATA.card_reader },
      { type: 'door_position', label: 'Door Position Switch', symbol: 'DPS', reportIcon: REPORT_ICON_DATA.door_position },
      { type: 'double_door', label: 'Double Door', symbol: 'DD', reportIcon: REPORT_ICON_DATA.double_door },
      { type: 'electric_exit_device', label: 'Electric Exit Device', symbol: 'EED', reportIcon: REPORT_ICON_DATA.electric_exit_device },
      { type: 'electric_lockset', label: 'Electric Lockset', symbol: 'ELOK', reportIcon: REPORT_ICON_DATA.electric_lockset },
      { type: 'electric_strike', label: 'Electric Strike', symbol: 'ES', reportIcon: REPORT_ICON_DATA.electric_strike },
      { type: 'handicap_push_button', label: 'Handicap Push Button', symbol: 'ADA', reportIcon: REPORT_ICON_DATA.handicap_push_button },
      { type: 'network_patch_panel', label: 'Network Patch Panel', symbol: 'PP', reportIcon: REPORT_ICON_DATA.network_patch_panel },
      { type: 'network_switch', label: 'Network Switch', symbol: 'SW', reportIcon: REPORT_ICON_DATA.network_switch },
      { type: 'request_to_exit', label: 'Request to Exit', symbol: 'REX', reportIcon: REPORT_ICON_DATA.request_to_exit },
      { type: 'single_door', label: 'Single Door', symbol: 'SD', reportIcon: REPORT_ICON_DATA.single_door },
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
      { type: 'single_door', label: 'Single Door', symbol: '◧' },
      { type: 'double_door', label: 'Double Door', symbol: '◫' },
      { type: 'sliding_door', label: 'Sliding Door', symbol: '⇆' },
      { type: 'overhead_door', label: 'Overhead Door', symbol: '▤' },
      { type: 'hatch', label: 'Hatch', symbol: '▣' },
      { type: 'folding_door', label: 'Folding Door', symbol: '≋' },
      { type: 'revolving_door', label: 'Revolving Door', symbol: '⊕' },
      { type: 'gate', label: 'Vehicle Gate', symbol: '╫' },
      { type: 'turnstile', label: 'Turnstile', symbol: '✣' },
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

export const DEVICE_WORKFLOW_STATUSES = [
  { id: 'planned', label: 'Planned', color: '#64748b', progress: 0 },
  { id: 'ready', label: 'Ready for field', color: '#2563eb', progress: 10 },
  { id: 'in_progress', label: 'In progress', color: '#d97706', progress: 40 },
  { id: 'installed', label: 'Installed', color: '#7c3aed', progress: 70 },
  { id: 'tested', label: 'Tested / commissioned', color: '#0891b2', progress: 90 },
  { id: 'complete', label: 'Complete', color: '#15803d', progress: 100 },
  { id: 'blocked', label: 'Blocked / issue', color: '#b4232d', progress: 40 },
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

export function isCameraType(type) {
  return ['fixed_camera', 'dome_camera', 'ptz_camera', 'multisensor_camera', 'lpr_camera'].includes(type);
}

export function workflowStatusFor(element) {
  const id = element?.metadata?.workflowStatus || 'planned';
  return DEVICE_WORKFLOW_STATUSES.find((status) => status.id === id) || DEVICE_WORKFLOW_STATUSES[0];
}

export function cameraFieldsFor(element) {
  const metadata = element?.metadata || {};
  const color = elementColor(element || {});
  if (element?.type === 'multisensor_camera') {
    const supplied = Array.isArray(metadata.fovs) ? metadata.fovs.slice(0, 4) : [];
    return [0, 1, 2, 3].map((index) => ({
      id: supplied[index]?.id || `fov-${index + 1}`,
      rotation: Number(supplied[index]?.rotation ?? index * 90),
      color: supplied[index]?.color || color,
      length: Number(supplied[index]?.length ?? 0.22),
      spread: Number(supplied[index]?.spread ?? 60),
    }));
  }
  return [{ id: 'primary', rotation: Number(metadata.fovRotation || 0), color: metadata.fovColor || color, length: Number(metadata.fovLength ?? 0.22), spread: Number(metadata.fovSpread ?? 60) }];
}

export function defaultMetadataForDevice(type, symbol, color) {
  const multisensorFovs = type === 'multisensor_camera' ? {
    fovs: [0, 90, 180, 270].map((rotation, index) => ({
      id: `fov-${index + 1}`, rotation, color, length: 0.22, spread: 60,
    })),
  } : {};
  return {
    symbol,
    size: 42,
    workflowStatus: 'planned',
    ...(isCameraType(type) ? { fovColor: color, fovLength: 0.22, fovSpread: 60, fovRotation: 0, ...multisensorFovs } : {}),
  };
}
