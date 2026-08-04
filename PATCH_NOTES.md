SecurePlan patch bundle

Included source files
- src/components/deviceLibrary.js
  - Restores the plotted icon outline behavior by keeping door colors data-driven.
  - Adds Access Control icons for Panic Button and Lockdown Button.
- src/components/DeviceGlyph.jsx
  - Draws visible outlines for plotted icons.
  - Uses the plotted icon color for the stroke so the door-function color still drives the outline.
  - Adds a bordered fallback badge for symbols that do not have a dedicated SVG glyph.
- src/components/surveyPdfExport.js
  - Generates a downloadable PDF report with site name, survey name, total plotted devices, counts by system, and counts by device type.

How to wire the PDF export into the app
1. In src/components/SiteWorkspace.jsx, add:

   import { downloadSurveyPdf } from './surveyPdfExport.js';

2. In the survey card action menu, add an item such as:

   <MenuButton onClick={async () => {
     const elements = await api.elements(survey.id);
     downloadSurveyPdf({ survey, site, elements });
   }}>Export PDF</MenuButton>

3. To make the site folder layout more streamlined, keep the current folder tree on desktop but switch the folder summary area to larger chips/cards on mobile. The easiest place to do that is the folder sidebar and the folder filter bar inside SiteWorkspace.

4. To make the landing page more leadership-friendly, add a hero summary at the top of src/components/SitesDashboard.jsx with quick tiles for:
   - Total sites
   - Total surveys
   - Recently updated sites
   - Open sites needing attention

Recommended next UI refinements
- Make the site dashboard start with a large search bar and four summary tiles.
- Keep survey groups collapsed by default on mobile and expanded on desktop.
- Surface only the most relevant folders first: Site root, Recent, and All folders.
- Add the PDF export button beside open/copy/move actions so leadership can quickly produce a report.

Notes
- This bundle is safe to merge into the repo you already have.
- The PDF helper assumes the app can fetch survey elements with api.elements(survey.id), which the current client already supports.
