import assert from 'node:assert/strict';
import test from 'node:test';
import { DEVICE_CATEGORIES, defaultMetadataForDevice, isCameraType } from '../../src/components/deviceLibrary.js';

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
    assert.deepEqual(defaultMetadataForDevice(type, 'CAM', '#1769aa'), {
      symbol: 'CAM', size: 42, fovColor: '#1769aa', fovLength: 0.22, fovSpread: 60,
    });
  }
  assert.deepEqual(defaultMetadataForDevice('card_reader', 'CR', '#b4232d'), { symbol: 'CR', size: 42 });
});
