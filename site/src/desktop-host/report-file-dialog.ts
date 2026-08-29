export type ReportFileTitle = 'Balance Sheet' | 'Statement of Cash Flows';
export type ReportFileType = 'CSV' | 'XLSX' | 'HTML';

export interface ReportFileDialogOptions {
  readonly title: string;
  readonly defaultPath: string;
  readonly filters: { name: string; extensions: string[] }[];
}

/**
 * Keep report-file dialog copy and filters deterministic at the native
 * boundary. Unknown callers intentionally retain the legacy Balance Sheet
 * default instead of allowing arbitrary renderer-provided titles.
 */
export function reportFileDialogOptions(
  suggestedFileName: string,
  fileType: ReportFileType,
  requestedReportTitle?: ReportFileTitle,
): ReportFileDialogOptions {
  const reportTitle: ReportFileTitle = requestedReportTitle === 'Statement of Cash Flows' ? 'Statement of Cash Flows' : 'Balance Sheet';
  const extensions = fileType === 'CSV' ? ['csv'] : fileType === 'XLSX' ? ['xlsx'] : ['html'];
  return {
    title: `Save ${reportTitle} ${fileType}`,
    defaultPath: suggestedFileName,
    filters: [{ name: `${reportTitle} ${fileType}`, extensions }],
  };
}
