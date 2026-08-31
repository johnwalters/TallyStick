export interface PrintCommandWebContents {
  send(channel: 'report-preview:request-open'): void;
  print(options: { readonly printBackground: true }): void;
}

export interface PrintCommandWindow {
  readonly webContents: PrintCommandWebContents;
}

/**
 * File > Print and Command-P open the report preview from the main workspace.
 * The actual native print dialog is available only after the user has opened
 * a preview and explicitly invokes the command from that preview window.
 */
export function routePrintCommand(
  focusedWindow: PrintCommandWindow | undefined,
  mainApplicationWindow: PrintCommandWindow | undefined,
): void {
  if (!focusedWindow) return;
  if (focusedWindow === mainApplicationWindow) {
    focusedWindow.webContents.send('report-preview:request-open');
    return;
  }
  focusedWindow.webContents.print({ printBackground: true });
}
