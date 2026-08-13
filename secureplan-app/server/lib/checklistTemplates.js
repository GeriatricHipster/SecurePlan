const DOOR_HARDWARE_STATUS_OPTIONS = ['Not installed', 'In process', 'Installed', 'Tested', 'Troubleshoot', 'Forced', 'Held'];
const DOOR_CHECKLIST_ITEMS = [
  { key: 'wire_pulled', label: 'Wire Pulled', options: DOOR_HARDWARE_STATUS_OPTIONS },
  { key: 'dps', label: 'DPS', options: DOOR_HARDWARE_STATUS_OPTIONS },
  { key: 'rex', label: 'REX', options: DOOR_HARDWARE_STATUS_OPTIONS },
  { key: 'reader', label: 'Reader', options: DOOR_HARDWARE_STATUS_OPTIONS },
  { key: 'door_lock', label: 'Door Lock', options: DOOR_HARDWARE_STATUS_OPTIONS },
];

const PANEL_CHECKLIST_ITEMS = [
  { key: 'panel', label: 'Panel', options: ['Ordered', 'Waiting for shipment', 'Mounted', 'Needs power', 'Needs network', 'Online'] },
];

const CAMERA_STATUS_OPTIONS = ['Not installed', 'In process', 'Cable pulled', 'Installed', 'IPd', 'MAC sent', 'Aimed', 'Troubleshoot', 'Re-aim', 'Pulled in'];
const CAMERA_CHECKLIST_ITEMS = [
  { key: 'camera', label: 'Camera', options: CAMERA_STATUS_OPTIONS },
];

export const CUSTOM_CHECKLIST_STATUS_OPTIONS = DOOR_HARDWARE_STATUS_OPTIONS;

const CHECKLIST_TEMPLATES = {
  single_door: DOOR_CHECKLIST_ITEMS,
  double_door: DOOR_CHECKLIST_ITEMS,
  overhead_door: DOOR_CHECKLIST_ITEMS,
  sliding_door: DOOR_CHECKLIST_ITEMS,
  folding_door: DOOR_CHECKLIST_ITEMS,
  revolving_door: DOOR_CHECKLIST_ITEMS,
  gate: DOOR_CHECKLIST_ITEMS,
  turnstile: DOOR_CHECKLIST_ITEMS,
  hatch: DOOR_CHECKLIST_ITEMS,
  access_panel: PANEL_CHECKLIST_ITEMS,
  fixed_camera: CAMERA_CHECKLIST_ITEMS,
  dome_camera: CAMERA_CHECKLIST_ITEMS,
  ptz_camera: CAMERA_CHECKLIST_ITEMS,
  multisensor_camera: CAMERA_CHECKLIST_ITEMS,
  lpr_camera: CAMERA_CHECKLIST_ITEMS,
};

export function checklistTemplateFor(type) {
  return CHECKLIST_TEMPLATES[type] || null;
}
