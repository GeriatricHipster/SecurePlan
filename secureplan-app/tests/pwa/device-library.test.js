import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_ICON_COLOR,
  DEVICE_CATEGORIES,
  DEVICE_WORKFLOW_STATUSES,
  DOOR_FUNCTIONS,
  cameraFieldsFor,
  defaultMetadataForDevice,
  devicePlacementDefaults,
  doorFunctionFor,
  elementColor,
  isCameraType,
  isDoorType,
  workflowStatusFor,
} from '../../src/components/deviceLibrary.js';

test('Access Control includes every icon supplied in the elements report', () => {
  const access = DEVICE_CATEGORIES.find((category) => category.id === 'access_control');
  const expected = ['automatic_door_operator', 'biometric_reader', 'card_reader', 'door_position', 'double_door', 'electric_exit_device', 'electric_lockset', 'electric_strike', 'handicap_push_button', 'network_patch_panel', 'network_switch', 'request_to_exit', 'single_door'];
  for (const type of expected) {
    const item = access.items.find((candidate) => candidate.type === type);
    assert.ok(item, `missing ${type}`);
    assert.match(item.reportIcon, /^data:image\/png;base64,/);
  }
});

test('door library contains the requested original blueprint opening symbols', () => {
  const doors = DEVICE_CATEGORIES.find((category) => category.id === 'doors');
  const types = new Set(doors.items.map((item) => item.type));
  for (const type of ['single_door', 'double_door', 'sliding_door', 'overhead_door', 'hatch']) {
    assert.equal(types.has(type), true, `missing ${type}`);
  }
  assert.equal(new Set(doors.items.map((item) => item.symbol)).size, doors.items.length);
});

test('every plotted camera receives a manipulable field-of-view cone by default', () => {
  for (const type of ['fixed_camera', 'dome_camera', 'ptz_camera', 'multisensor_camera', 'lpr_camera']) {
    assert.equal(isCameraType(type), true);
    const metadata = defaultMetadataForDevice(type, 'CAM', '#1769aa');
    assert.equal(metadata.fovRotation, 0);
    assert.equal(metadata.fovColor, '#1769aa');
    assert.equal(metadata.fovLength, 0.22);
    assert.equal(metadata.fovSpread, 60);
    if (type === 'multisensor_camera') {
      assert.deepEqual(metadata.fovs.map((fov) => fov.rotation), [0, 90, 180, 270]);
      assert.equal(metadata.fovs.every((fov) => fov.color === '#1769aa'), true);
    }
  }
  assert.deepEqual(defaultMetadataForDevice('card_reader', 'CR', '#b4232d'), { symbol: 'CR', size: 42, workflowStatus: 'planned' });
});

test('legacy or incomplete multisensor metadata safely expands to four independent views', () => {
  const fields = cameraFieldsFor({ type: 'multisensor_camera', color: '#1769aa', metadata: { fovs: [{ rotation: 35, color: '#ff0000' }] } });
  assert.equal(fields.length, 4);
  assert.deepEqual(fields.map((field) => field.rotation), [35, 90, 180, 270]);
  assert.equal(fields[0].color, '#ff0000');
  assert.equal(fields.slice(1).every((field) => field.color === '#1769aa'), true);
});

test('device lifecycle statuses provide stable field progress and safe fallbacks', () => {
  assert.deepEqual(DEVICE_WORKFLOW_STATUSES.map((status) => status.id), ['planned', 'ready', 'in_progress', 'installed', 'tested', 'complete', 'blocked']);
  assert.deepEqual(Object.fromEntries(DEVICE_WORKFLOW_STATUSES.map((status) => [status.id, status.color])), {
    planned: '#64748b', ready: '#2563eb', in_progress: '#facc15', installed: '#7c3aed', tested: '#0891b2', complete: '#15803d', blocked: '#b4232d',
  });
  assert.equal(workflowStatusFor({ metadata: { workflowStatus: 'in_progress' } }).textColor, '#713f12');
  assert.equal(workflowStatusFor({ metadata: { workflowStatus: 'complete' } }).progress, 100);
  assert.equal(workflowStatusFor({ metadata: { workflowStatus: 'not-a-real-status' } }).id, 'planned');
  assert.equal(workflowStatusFor({}).id, 'planned');
});

test('new and incomplete device records default to blue while saved color choices win', () => {
  assert.equal(DEFAULT_ICON_COLOR, '#1769aa');
  assert.equal(elementColor({ category: 'access_control' }), DEFAULT_ICON_COLOR);
  assert.equal(elementColor({ category: 'intrusion', color: '#ff00aa' }), '#ff00aa');
});

test('door functions have exact automatic colors and Controlled is the safe default', () => {
  assert.deepEqual(DOOR_FUNCTIONS.map(({ id, label, color }) => ({ id, label, color })), [
    { id: 'monitored', label: 'Monitored', color: '#b68a5a' },
    { id: 'controlled', label: 'Controlled', color: '#1769aa' },
    { id: 'full', label: 'Full', color: '#15803d' },
  ]);
  assert.equal(doorFunctionFor('monitored').color, '#b68a5a');
  assert.equal(doorFunctionFor({ metadata: { doorFunction: 'full' } }).color, '#15803d');
  assert.equal(doorFunctionFor(undefined).id, 'controlled');
  assert.equal(doorFunctionFor('not-a-door-function').id, 'controlled');
});

test('only actual door-opening icons receive door-function behavior', () => {
  const qualifying = [
    'single_door',
    'double_door',
    'sliding_door',
    'overhead_door',
    'hatch',
    'folding_door',
    'revolving_door',
  ];
  const nonqualifying = [
    'automatic_door_operator',
    'card_reader',
    'door_position',
    'electric_lockset',
    'gate',
    'turnstile',
    'opening_note',
    'fixed_camera',
    'motion_detector',
  ];
  for (const type of qualifying) assert.equal(isDoorType(type), true, `${type} should qualify`);
  for (const type of nonqualifying) assert.equal(isDoorType(type), false, `${type} should not qualify`);

  const accessControl = DEVICE_CATEGORIES.find((category) => category.id === 'access_control');
  assert.equal(accessControl.items.some((item) => item.type === 'single_door' && isDoorType(item.type)), true);
  assert.equal(accessControl.items.some((item) => item.type === 'double_door' && isDoorType(item.type)), true);
});

test('door placement stores its function and automatic color while preserving a separate planned status', () => {
  for (const option of DOOR_FUNCTIONS) {
    const placement = devicePlacementDefaults('single_door', 'SD', option.id);
    assert.equal(placement.color, option.color, `${option.label} should use its automatic color`);
    assert.equal(placement.metadata.doorFunction, option.id);
    assert.equal(placement.metadata.workflowStatus, 'planned');
    assert.equal(placement.metadata.symbol, 'SD');
    assert.equal(placement.metadata.size, 42);
  }

  const defaultDoor = devicePlacementDefaults('double_door', 'DD');
  assert.equal(defaultDoor.color, DEFAULT_ICON_COLOR);
  assert.equal(defaultDoor.metadata.doorFunction, 'controlled');
});

test('non-door placement stays blue and never inherits a selected door function', () => {
  for (const [type, symbol] of [['card_reader', 'CR'], ['fixed_camera', 'CAM'], ['motion_detector', 'PIR']]) {
    const placement = devicePlacementDefaults(type, symbol, 'full');
    assert.equal(placement.color, DEFAULT_ICON_COLOR, `${type} should remain blue`);
    assert.equal(Object.hasOwn(placement.metadata, 'doorFunction'), false);
    assert.equal(placement.metadata.workflowStatus, 'planned');
  }
});

test('workflow status and manual icon color remain independent values', () => {
  const manuallyColoredDoor = {
    type: 'single_door',
    color: '#ff00aa',
    metadata: { doorFunction: 'monitored', workflowStatus: 'complete' },
  };
  assert.equal(elementColor(manuallyColoredDoor), '#ff00aa');
  assert.equal(workflowStatusFor(manuallyColoredDoor).color, '#15803d');
  assert.equal(doorFunctionFor(manuallyColoredDoor).color, '#b68a5a');
});
