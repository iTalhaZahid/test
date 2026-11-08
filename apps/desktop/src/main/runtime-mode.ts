export function allowsDemo(isPackaged: boolean, appName: string) {
  return !isPackaged || appName === 'POS Terminal Demo';
}
