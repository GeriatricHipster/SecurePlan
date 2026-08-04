# SecurePlan Physical-Security Lifecycle Roadmap

SecurePlan will keep its existing surveyor, collaboration, cloud, web, iOS, and Android foundation while expanding into an end-to-end physical-security lifecycle platform. The goal is SiteOwl-equivalent capability with a simpler field experience and SecurePlan-specific improvements—not a copy of SiteOwl branding or proprietary interface design.

## What SecurePlan already provides

- Sites, folders, separate PDF surveys, copying, moving, renaming, and deletion
- Drag-and-drop security devices and reusable assemblies
- Access Control, CCTV, Intrusion, Doors, and Custom libraries
- Editable lines, arrows, shapes, text, camera fields of view, and multisensor views
- Device notes, cloud photos, schedules, editing history, invitations, roles, and realtime collaboration
- Responsive web/PWA plus synchronized Capacitor iOS and Android projects

## Phase 1 — Lifecycle device foundation (implemented in 0.8.0)

- Statuses: Planned, Ready for field, In progress, Installed, Tested/commissioned, Complete, and Blocked/issue
- Status indicators directly on plan devices
- Assigned technician/vendor, target date, and calculated progress
- Asset attributes: manufacturer, model, part number, serial number, IP, MAC, install date, and warranty expiration
- Workflow summary and expanded lifecycle/asset CSV export
- Safe fallback for legacy devices that do not yet have lifecycle metadata

## Phase 2 — Projects and installations

- Project scope, start/end dates, budget, project manager, integrator, and vendor assignments
- Device/task checklists with dependencies and required completion evidence
- Bulk assignment and bulk status updates by plan, system, floor, vendor, or selection
- Flags, blockers, RFIs, punch items, severity, responsible party, due date, comments, and resolution photos
- Daily field reports, percent complete, activity feed, and overdue dashboard
- Change orders with impact, approval history, cost, and schedule effect

### SecurePlan improvements

- Offline field-change queue with visible sync state and conflict recovery
- QR/barcode scanning to open the exact asset record
- Evidence rules that can require a photo, serial number, test result, or note before completion
- Undo/version history for plan and bulk changes

## Phase 3 — Commissioning and closeout

- Configurable commissioning forms by device type
- Pass/fail/not-applicable test steps and measured values
- Failed-test corrective actions and retesting history
- Closeout readiness dashboard with missing-evidence validation
- Approved as-built plan snapshot, final BOM, asset register, photos, warranties, and commissioning package
- PDF/CSV closeout export organized by site, floor, and system

## Phase 4 — Asset management and service

- Persistent asset record that continues after project closeout
- Operational condition, criticality, firmware, software/host, panel/port, lifecycle stage, and end-of-life date
- One-click service ticket from a plotted device
- Priority, assignee, SLA, work notes, parts, labor, resolution, downtime, and attachments
- Complete service history visible from the floor plan and asset record
- Preventive-maintenance schedules and warranty alerts

## Phase 5 — Audits and compliance

- Reusable audit templates for cameras, access control, intrusion, doors, and site conditions
- Recurring audit schedules and assignments
- Pass/fail/needs-action results with required evidence
- Corrective actions that become trackable tasks or service tickets
- Compliance dashboards and signed audit reports

## Phase 6 — Planning, standards, and budgeting

- Approved device catalog and organization standards
- Typical assemblies with required components and approved substitutions
- BOM quantities, manufacturer/part rollups, unit cost, labor allowance, and quote comparison
- Asset age, warranty, failure rate, criticality, and replacement-year forecasting
- Multi-site capital plans and budget scenarios
- Portfolio dashboards for device counts, installation progress, open issues, service performance, and lifecycle risk

## Recommended build order

1. Projects, device tasks, flags, and bulk status changes
2. Commissioning checklists and closeout validation
3. Persistent assets and service tickets
4. Audits and preventive maintenance
5. BOM, costing, standards, and capital planning
6. Offline queue, QR scanning, integrations, and advanced reporting

This sequence turns the current surveyor into a usable field-installation platform first, then extends the same verified device record through commissioning, service, audits, and long-term planning.
