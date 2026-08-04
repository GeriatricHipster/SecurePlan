import assert from 'node:assert/strict';
import test from 'node:test';
import { DEVICE_CATEGORIES, DEVICE_WORKFLOW_STATUSES, cameraFieldsFor, defaultMetadataForDevice, isCameraType, workflowStatusFor } from '../../src/components/deviceLibrary.js';

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
  assert.equal(workflowStatusFor({ metadata: { workflowStatus: 'complete' } }).progress, 100);
  assert.equal(workflowStatusFor({ metadata: { workflowStatus: 'not-a-real-status' } }).id, 'planned');
  assert.equal(workflowStatusFor({}).id, 'planned');
});
