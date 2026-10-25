// DELETION NOTE (D3.7): `AdminReports.tsx` was split into
// `AdminReportsList.tsx` (queue list + pure display helpers) and
// `AdminReportDetail.tsx` (report detail + confirm-gated mutations).
// This module is a re-export shim so existing importers
// (`Navigation.tsx`, `AdminReports.test.tsx`) keep compiling unchanged.
// Delete it and point callers at the two new modules directly.

export * from './AdminReportsList'
export * from './AdminReportDetail'
