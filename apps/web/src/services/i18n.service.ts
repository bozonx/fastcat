export interface I18nService {
  t: (key: string, ...args: unknown[]) => string;
}
