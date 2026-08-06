# SecurePlan measurement / library / fullscreen patch

This bundle contains a script that patches the current `secureplan-app` source tree with:

- a measurement line tool that uses the blueprint scale
- a measurement scale modal so the scale can be set per survey
- a full screen toggle in the survey editor
- renaming the Sites page / navigation text to Library
- helper styling for measurement labels and full screen mode

## How to use

1. Unzip this bundle into the root of your SecurePlan repository.
2. Run:

   ```bash
   python apply_changes.py
   ```

3. Review the changed files in GitHub Desktop and commit them.

## Files touched by the patch

- `secureplan-app/src/components/deviceLibrary.js`
- `secureplan-app/src/components/SurveyEditor.jsx`
- `secureplan-app/src/components/PdfPlan.jsx`
- `secureplan-app/src/components/SitesDashboard.jsx`
- `secureplan-app/src/App.jsx`
- `secureplan-app/src/styles.css`

## Notes

- The measurement tool is added as a new markup tool and renders as a red measurement line.
- The scale is saved on the survey record using `measurementScale` and `measurementUnits`.
- The full screen button uses the browser Fullscreen API.
- The app keeps the `/sites` route, but the visible labels become Library.
