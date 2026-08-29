import { reportFileDialogOptions, ReportFileDialogOptions, ReportFileTitle, ReportFileType } from './report-file-dialog';

export interface ReportFileDialogResult {
  readonly canceled: boolean;
  readonly filePath?: string;
}

export interface ReportFileSaveDependencies {
  readonly showSaveDialog: (options: ReportFileDialogOptions) => Promise<ReportFileDialogResult>;
  readonly writeFile: (path: string, bytes: Uint8Array, options: { readonly flag: 'wx' }) => Promise<void>;
  readonly rename: (oldPath: string, newPath: string) => Promise<void>;
  readonly remove: (path: string, options: { readonly force: true }) => Promise<void>;
  readonly processId: number;
}

/**
 * Native report save flow. The dialog result is intentionally reduced to a
 * cancellation or successful commit; host errors remain internal and are
 * redacted by the application output service before reaching the renderer.
 */
export async function saveReportFile(
  suggestedFileName: string,
  bytes: Uint8Array,
  fileType: ReportFileType,
  reportTitle: ReportFileTitle | undefined,
  dependencies: ReportFileSaveDependencies,
): Promise<'SAVED' | 'CANCELLED'> {
  const result = await dependencies.showSaveDialog(reportFileDialogOptions(suggestedFileName, fileType, reportTitle));
  if (result.canceled || !result.filePath) return 'CANCELLED';
  const temporaryPath = `${result.filePath}.tallystick-${dependencies.processId}.tmp`;
  try {
    await dependencies.writeFile(temporaryPath, bytes, { flag: 'wx' });
    await dependencies.rename(temporaryPath, result.filePath);
  } catch (error) {
    await dependencies.remove(temporaryPath, { force: true });
    throw error;
  }
  return 'SAVED';
}
