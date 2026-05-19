//#region ../../node_modules/.pnpm/@rolldown+pluginutils@1.0.0-rc.3/node_modules/@rolldown/pluginutils/dist/filter/composable-filters.d.ts
type StringOrRegExp = string | RegExp;
type PluginModuleType = 'js' | 'jsx' | 'ts' | 'tsx' | 'json' | 'text' | 'base64' | 'dataurl' | 'binary' | 'empty' | (string & {});
type FilterExpression = And | Or | Not | Id | ImporterId | ModuleType | Code | Query;
type TopLevelFilterExpression = Include | Exclude;
declare class And {
  kind: 'and';
  args: FilterExpression[];
  constructor(...args: FilterExpression[]);
}
declare class Or {
  kind: 'or';
  args: FilterExpression[];
  constructor(...args: FilterExpression[]);
}
declare class Not {
  kind: 'not';
  expr: FilterExpression;
  constructor(expr: FilterExpression);
}
interface IdParams {
  cleanUrl?: boolean;
}
declare class Id {
  kind: 'id';
  pattern: StringOrRegExp;
  params: IdParams;
  constructor(pattern: StringOrRegExp, params?: IdParams);
}
declare class ImporterId {
  kind: 'importerId';
  pattern: StringOrRegExp;
  params: IdParams;
  constructor(pattern: StringOrRegExp, params?: IdParams);
}
declare class ModuleType {
  kind: 'moduleType';
  pattern: PluginModuleType;
  constructor(pattern: PluginModuleType);
}
declare class Code {
  kind: 'code';
  pattern: StringOrRegExp;
  constructor(expr: StringOrRegExp);
}
declare class Query {
  kind: 'query';
  key: string;
  pattern: StringOrRegExp | boolean;
  constructor(key: string, pattern: StringOrRegExp | boolean);
}
declare class Include {
  kind: 'include';
  expr: FilterExpression;
  constructor(expr: FilterExpression);
}
declare class Exclude {
  kind: 'exclude';
  expr: FilterExpression;
  constructor(expr: FilterExpression);
}
//#endregion
export { TopLevelFilterExpression as t };