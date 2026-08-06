import React from 'react';

export default function MeasurementTool({
  enabled,
  onToggle,
  scalePxPerFoot,
  onSetScalePxPerFoot,
  measurement,
  onClearMeasure,
}) {
  const [calibrationFeet, setCalibrationFeet] = React.useState('10');

  const calibrate = () => {
    const feet = Number(calibrationFeet);
    if (!measurement?.pixelDistance || !feet || feet <= 0) return;
    onSetScalePxPerFoot(measurement.pixelDistance / feet);
  };

  const lengthFeet =
    scalePxPerFoot && measurement?.pixelDistance
      ? measurement.pixelDistance / scalePxPerFoot
      : null;

  return (
    <div className="panel p-3 rounded-2xl">
      <div className="flex items-center gap-2">
        <button type="button" className="button button--secondary" onClick={onToggle}>
          {enabled ? 'Exit Measure' : 'Measure'}
        </button>
        <button type="button" className="button button--secondary" onClick={onClearMeasure}>
          Clear
        </button>
      </div>

      <div className="mt-3 grid gap-3">
        <label className="field">
          <span className="field__label">Calibrate scale using known distance (feet)</span>
          <input
            value={calibrationFeet}
            onChange={(e) => setCalibrationFeet(e.target.value)}
            inputMode="decimal"
            placeholder="10"
          />
        </label>

        <button type="button" className="button button--primary" onClick={calibrate}>
          Set Blueprint Scale
        </button>

        <div className="text-sm">
          {lengthFeet != null ? (
            <strong>{lengthFeet.toFixed(2)} ft</strong>
          ) : (
            <span>Click two points to measure a line.</span>
          )}
        </div>
      </div>
    </div>
  );
}
