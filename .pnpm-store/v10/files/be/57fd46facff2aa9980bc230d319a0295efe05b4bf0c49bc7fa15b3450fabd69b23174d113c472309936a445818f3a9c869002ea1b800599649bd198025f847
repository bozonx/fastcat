//#region ../../node_modules/.pnpm/@oxc-project+types@0.112.0/node_modules/@oxc-project/types/types.d.ts
// Auto-generated code, DO NOT EDIT DIRECTLY!
// To edit this generated file you have to edit `tasks/ast_tools/src/generators/typescript.rs`.
interface Program extends Span {
  type: "Program";
  body: Array<Directive | Statement>;
  sourceType: ModuleKind;
  hashbang: Hashbang | null;
  parent?: null;
}
type Expression = BooleanLiteral | NullLiteral | NumericLiteral | BigIntLiteral | RegExpLiteral | StringLiteral | TemplateLiteral | IdentifierReference | MetaProperty | Super | ArrayExpression | ArrowFunctionExpression | AssignmentExpression | AwaitExpression | BinaryExpression | CallExpression | ChainExpression | Class | ConditionalExpression | Function | ImportExpression | LogicalExpression | NewExpression | ObjectExpression | ParenthesizedExpression | SequenceExpression | TaggedTemplateExpression | ThisExpression | UnaryExpression | UpdateExpression | YieldExpression | PrivateInExpression | JSXElement | JSXFragment | TSAsExpression | TSSatisfiesExpression | TSTypeAssertion | TSNonNullExpression | TSInstantiationExpression | V8IntrinsicExpression | MemberExpression;
interface IdentifierName extends Span {
  type: "Identifier";
  decorators?: [];
  name: string;
  optional?: false;
  typeAnnotation?: null;
  parent?: Node;
}
interface IdentifierReference extends Span {
  type: "Identifier";
  decorators?: [];
  name: string;
  optional?: false;
  typeAnnotation?: null;
  parent?: Node;
}
interface BindingIdentifier extends Span {
  type: "Identifier";
  decorators?: [];
  name: string;
  optional?: false;
  typeAnnotation?: null;
  parent?: Node;
}
interface LabelIdentifier extends Span {
  type: "Identifier";
  decorators?: [];
  name: string;
  optional?: false;
  typeAnnotation?: null;
  parent?: Node;
}
interface ThisExpression extends Span {
  type: "ThisExpression";
  parent?: Node;
}
interface ArrayExpression extends Span {
  type: "ArrayExpression";
  elements: Array<ArrayExpressionElement>;
  parent?: Node;
}
type ArrayExpressionElement = SpreadElement | null | Expression;
interface ObjectExpression extends Span {
  type: "ObjectExpression";
  properties: Array<ObjectPropertyKind>;
  parent?: Node;
}
type ObjectPropertyKind = ObjectProperty | SpreadElement;
interface ObjectProperty extends Span {
  type: "Property";
  kind: PropertyKind;
  key: PropertyKey;
  value: Expression;
  method: boolean;
  shorthand: boolean;
  computed: boolean;
  optional?: false;
  parent?: Node;
}
type PropertyKey = IdentifierName | PrivateIdentifier | Expression;
type PropertyKind = "init" | "get" | "set";
interface TemplateLiteral extends Span {
  type: "TemplateLiteral";
  quasis: Array<TemplateElement>;
  expressions: Array<Expression>;
  parent?: Node;
}
interface TaggedTemplateExpression extends Span {
  type: "TaggedTemplateExpression";
  tag: Expression;
  typeArguments?: TSTypeParameterInstantiation | null;
  quasi: TemplateLiteral;
  parent?: Node;
}
interface TemplateElement extends Span {
  type: "TemplateElement";
  value: TemplateElementValue;
  tail: boolean;
  parent?: Node;
}
interface TemplateElementValue {
  raw: string;
  cooked: string | null;
}
type MemberExpression = ComputedMemberExpression | StaticMemberExpression | PrivateFieldExpression;
interface ComputedMemberExpression extends Span {
  type: "MemberExpression";
  object: Expression;
  property: Expression;
  optional: boolean;
  computed: true;
  parent?: Node;
}
interface StaticMemberExpression extends Span {
  type: "MemberExpression";
  object: Expression;
  property: IdentifierName;
  optional: boolean;
  computed: false;
  parent?: Node;
}
interface PrivateFieldExpression extends Span {
  type: "MemberExpression";
  object: Expression;
  property: PrivateIdentifier;
  optional: boolean;
  computed: false;
  parent?: Node;
}
interface CallExpression extends Span {
  type: "CallExpression";
  callee: Expression;
  typeArguments?: TSTypeParameterInstantiation | null;
  arguments: Array<Argument>;
  optional: boolean;
  parent?: Node;
}
interface NewExpression extends Span {
  type: "NewExpression";
  callee: Expression;
  typeArguments?: TSTypeParameterInstantiation | null;
  arguments: Array<Argument>;
  parent?: Node;
}
interface MetaProperty extends Span {
  type: "MetaProperty";
  meta: IdentifierName;
  property: IdentifierName;
  parent?: Node;
}
interface SpreadElement extends Span {
  type: "SpreadElement";
  argument: Expression;
  parent?: Node;
}
type Argument = SpreadElement | Expression;
interface UpdateExpression extends Span {
  type: "UpdateExpression";
  operator: UpdateOperator;
  prefix: boolean;
  argument: SimpleAssignmentTarget;
  parent?: Node;
}
interface UnaryExpression extends Span {
  type: "UnaryExpression";
  operator: UnaryOperator;
  argument: Expression;
  prefix: true;
  parent?: Node;
}
interface BinaryExpression extends Span {
  type: "BinaryExpression";
  left: Expression;
  operator: BinaryOperator;
  right: Expression;
  parent?: Node;
}
interface PrivateInExpression extends Span {
  type: "BinaryExpression";
  left: PrivateIdentifier;
  operator: "in";
  right: Expression;
  parent?: Node;
}
interface LogicalExpression extends Span {
  type: "LogicalExpression";
  left: Expression;
  operator: LogicalOperator;
  right: Expression;
  parent?: Node;
}
interface ConditionalExpression extends Span {
  type: "ConditionalExpression";
  test: Expression;
  consequent: Expression;
  alternate: Expression;
  parent?: Node;
}
interface AssignmentExpression extends Span {
  type: "AssignmentExpression";
  operator: AssignmentOperator;
  left: AssignmentTarget;
  right: Expression;
  parent?: Node;
}
type AssignmentTarget = SimpleAssignmentTarget | AssignmentTargetPattern;
type SimpleAssignmentTarget = IdentifierReference | TSAsExpression | TSSatisfiesExpression | TSNonNullExpression | TSTypeAssertion | MemberExpression;
type AssignmentTargetPattern = ArrayAssignmentTarget | ObjectAssignmentTarget;
interface ArrayAssignmentTarget extends Span {
  type: "ArrayPattern";
  decorators?: [];
  elements: Array<AssignmentTargetMaybeDefault | AssignmentTargetRest | null>;
  optional?: false;
  typeAnnotation?: null;
  parent?: Node;
}
interface ObjectAssignmentTarget extends Span {
  type: "ObjectPattern";
  decorators?: [];
  properties: Array<AssignmentTargetProperty | AssignmentTargetRest>;
  optional?: false;
  typeAnnotation?: null;
  parent?: Node;
}
interface AssignmentTargetRest extends Span {
  type: "RestElement";
  decorators?: [];
  argument: AssignmentTarget;
  optional?: false;
  typeAnnotation?: null;
  value?: null;
  parent?: Node;
}
type AssignmentTargetMaybeDefault = AssignmentTargetWithDefault | AssignmentTarget;
interface AssignmentTargetWithDefault extends Span {
  type: "AssignmentPattern";
  decorators?: [];
  left: AssignmentTarget;
  right: Expression;
  optional?: false;
  typeAnnotation?: null;
  parent?: Node;
}
type AssignmentTargetProperty = AssignmentTargetPropertyIdentifier | AssignmentTargetPropertyProperty;
interface AssignmentTargetPropertyIdentifier extends Span {
  type: "Property";
  kind: "init";
  key: IdentifierReference;
  value: IdentifierReference | AssignmentTargetWithDefault;
  method: false;
  shorthand: true;
  computed: false;
  optional?: false;
  parent?: Node;
}
interface AssignmentTargetPropertyProperty extends Span {
  type: "Property";
  kind: "init";
  key: PropertyKey;
  value: AssignmentTargetMaybeDefault;
  method: false;
  shorthand: false;
  computed: boolean;
  optional?: false;
  parent?: Node;
}
interface SequenceExpression extends Span {
  type: "SequenceExpression";
  expressions: Array<Expression>;
  parent?: Node;
}
interface Super extends Span {
  type: "Super";
  parent?: Node;
}
interface AwaitExpression extends Span {
  type: "AwaitExpression";
  argument: Expression;
  parent?: Node;
}
interface ChainExpression extends Span {
  type: "ChainExpression";
  expression: ChainElement;
  parent?: Node;
}
type ChainElement = CallExpression | TSNonNullExpression | MemberExpression;
interface ParenthesizedExpression extends Span {
  type: "ParenthesizedExpression";
  expression: Expression;
  parent?: Node;
}
type Statement = BlockStatement | BreakStatement | ContinueStatement | DebuggerStatement | DoWhileStatement | EmptyStatement | ExpressionStatement | ForInStatement | ForOfStatement | ForStatement | IfStatement | LabeledStatement | ReturnStatement | SwitchStatement | ThrowStatement | TryStatement | WhileStatement | WithStatement | Declaration | ModuleDeclaration;
interface Directive extends Span {
  type: "ExpressionStatement";
  expression: StringLiteral;
  directive: string;
  parent?: Node;
}
interface Hashbang extends Span {
  type: "Hashbang";
  value: string;
  parent?: Node;
}
interface BlockStatement extends Span {
  type: "BlockStatement";
  body: Array<Statement>;
  parent?: Node;
}
type Declaration = VariableDeclaration | Function | Class | TSTypeAliasDeclaration | TSInterfaceDeclaration | TSEnumDeclaration | TSModuleDeclaration | TSGlobalDeclaration | TSImportEqualsDeclaration;
interface VariableDeclaration extends Span {
  type: "VariableDeclaration";
  kind: VariableDeclarationKind;
  declarations: Array<VariableDeclarator>;
  declare?: boolean;
  parent?: Node;
}
type VariableDeclarationKind = "var" | "let" | "const" | "using" | "await using";
interface VariableDeclarator extends Span {
  type: "VariableDeclarator";
  id: BindingPattern;
  init: Expression | null;
  definite?: boolean;
  parent?: Node;
}
interface EmptyStatement extends Span {
  type: "EmptyStatement";
  parent?: Node;
}
interface ExpressionStatement extends Span {
  type: "ExpressionStatement";
  expression: Expression;
  directive?: string | null;
  parent?: Node;
}
interface IfStatement extends Span {
  type: "IfStatement";
  test: Expression;
  consequent: Statement;
  alternate: Statement | null;
  parent?: Node;
}
interface DoWhileStatement extends Span {
  type: "DoWhileStatement";
  body: Statement;
  test: Expression;
  parent?: Node;
}
interface WhileStatement extends Span {
  type: "WhileStatement";
  test: Expression;
  body: Statement;
  parent?: Node;
}
interface ForStatement extends Span {
  type: "ForStatement";
  init: ForStatementInit | null;
  test: Expression | null;
  update: Expression | null;
  body: Statement;
  parent?: Node;
}
type ForStatementInit = VariableDeclaration | Expression;
interface ForInStatement extends Span {
  type: "ForInStatement";
  left: ForStatementLeft;
  right: Expression;
  body: Statement;
  parent?: Node;
}
type ForStatementLeft = VariableDeclaration | AssignmentTarget;
interface ForOfStatement extends Span {
  type: "ForOfStatement";
  await: boolean;
  left: ForStatementLeft;
  right: Expression;
  body: Statement;
  parent?: Node;
}
interface ContinueStatement extends Span {
  type: "ContinueStatement";
  label: LabelIdentifier | null;
  parent?: Node;
}
interface BreakStatement extends Span {
  type: "BreakStatement";
  label: LabelIdentifier | null;
  parent?: Node;
}
interface ReturnStatement extends Span {
  type: "ReturnStatement";
  argument: Expression | null;
  parent?: Node;
}
interface WithStatement extends Span {
  type: "WithStatement";
  object: Expression;
  body: Statement;
  parent?: Node;
}
interface SwitchStatement extends Span {
  type: "SwitchStatement";
  discriminant: Expression;
  cases: Array<SwitchCase>;
  parent?: Node;
}
interface SwitchCase extends Span {
  type: "SwitchCase";
  test: Expression | null;
  consequent: Array<Statement>;
  parent?: Node;
}
interface LabeledStatement extends Span {
  type: "LabeledStatement";
  label: LabelIdentifier;
  body: Statement;
  parent?: Node;
}
interface ThrowStatement extends Span {
  type: "ThrowStatement";
  argument: Expression;
  parent?: Node;
}
interface TryStatement extends Span {
  type: "TryStatement";
  block: BlockStatement;
  handler: CatchClause | null;
  finalizer: BlockStatement | null;
  parent?: Node;
}
interface CatchClause extends Span {
  type: "CatchClause";
  param: BindingPattern | null;
  body: BlockStatement;
  parent?: Node;
}
interface DebuggerStatement extends Span {
  type: "DebuggerStatement";
  parent?: Node;
}
type BindingPattern = BindingIdentifier | ObjectPattern | ArrayPattern | AssignmentPattern;
interface AssignmentPattern extends Span {
  type: "AssignmentPattern";
  decorators?: [];
  left: BindingPattern;
  right: Expression;
  optional?: false;
  typeAnnotation?: null;
  parent?: Node;
}
interface ObjectPattern extends Span {
  type: "ObjectPattern";
  decorators?: [];
  properties: Array<BindingProperty | BindingRestElement>;
  optional?: false;
  typeAnnotation?: null;
  parent?: Node;
}
interface BindingProperty extends Span {
  type: "Property";
  kind: "init";
  key: PropertyKey;
  value: BindingPattern;
  method: false;
  shorthand: boolean;
  computed: boolean;
  optional?: false;
  parent?: Node;
}
interface ArrayPattern extends Span {
  type: "ArrayPattern";
  decorators?: [];
  elements: Array<BindingPattern | BindingRestElement | null>;
  optional?: false;
  typeAnnotation?: null;
  parent?: Node;
}
interface BindingRestElement extends Span {
  type: "RestElement";
  decorators?: [];
  argument: BindingPattern;
  optional?: false;
  typeAnnotation?: null;
  value?: null;
  parent?: Node;
}
interface Function extends Span {
  type: FunctionType;
  id: BindingIdentifier | null;
  generator: boolean;
  async: boolean;
  declare?: boolean;
  typeParameters?: TSTypeParameterDeclaration | null;
  params: ParamPattern[];
  returnType?: TSTypeAnnotation | null;
  body: FunctionBody | null;
  expression: false;
  parent?: Node;
}
type ParamPattern = FormalParameter | TSParameterProperty | FormalParameterRest;
type FunctionType = "FunctionDeclaration" | "FunctionExpression" | "TSDeclareFunction" | "TSEmptyBodyFunctionExpression";
interface FormalParameterRest extends Span {
  type: "RestElement";
  argument: BindingPattern;
  decorators?: [];
  optional?: boolean;
  typeAnnotation?: TSTypeAnnotation | null;
  value?: null;
  parent?: Node;
}
type FormalParameter = {
  decorators?: Array<Decorator>;
} & BindingPattern;
interface TSParameterProperty extends Span {
  type: "TSParameterProperty";
  accessibility: TSAccessibility | null;
  decorators: Array<Decorator>;
  override: boolean;
  parameter: FormalParameter;
  readonly: boolean;
  static: boolean;
  parent?: Node;
}
interface FunctionBody extends Span {
  type: "BlockStatement";
  body: Array<Directive | Statement>;
  parent?: Node;
}
interface ArrowFunctionExpression extends Span {
  type: "ArrowFunctionExpression";
  expression: boolean;
  async: boolean;
  typeParameters?: TSTypeParameterDeclaration | null;
  params: ParamPattern[];
  returnType?: TSTypeAnnotation | null;
  body: FunctionBody | Expression;
  id: null;
  generator: false;
  parent?: Node;
}
interface YieldExpression extends Span {
  type: "YieldExpression";
  delegate: boolean;
  argument: Expression | null;
  parent?: Node;
}
interface Class extends Span {
  type: ClassType;
  decorators: Array<Decorator>;
  id: BindingIdentifier | null;
  typeParameters?: TSTypeParameterDeclaration | null;
  superClass: Expression | null;
  superTypeArguments?: TSTypeParameterInstantiation | null;
  implements?: Array<TSClassImplements>;
  body: ClassBody;
  abstract?: boolean;
  declare?: boolean;
  parent?: Node;
}
type ClassType = "ClassDeclaration" | "ClassExpression";
interface ClassBody extends Span {
  type: "ClassBody";
  body: Array<ClassElement>;
  parent?: Node;
}
type ClassElement = StaticBlock | MethodDefinition | PropertyDefinition | AccessorProperty | TSIndexSignature;
interface MethodDefinition extends Span {
  type: MethodDefinitionType;
  decorators: Array<Decorator>;
  key: PropertyKey;
  value: Function;
  kind: MethodDefinitionKind;
  computed: boolean;
  static: boolean;
  override?: boolean;
  optional?: boolean;
  accessibility?: TSAccessibility | null;
  parent?: Node;
}
type MethodDefinitionType = "MethodDefinition" | "TSAbstractMethodDefinition";
interface PropertyDefinition extends Span {
  type: PropertyDefinitionType;
  decorators: Array<Decorator>;
  key: PropertyKey;
  typeAnnotation?: TSTypeAnnotation | null;
  value: Expression | null;
  computed: boolean;
  static: boolean;
  declare?: boolean;
  override?: boolean;
  optional?: boolean;
  definite?: boolean;
  readonly?: boolean;
  accessibility?: TSAccessibility | null;
  parent?: Node;
}
type PropertyDefinitionType = "PropertyDefinition" | "TSAbstractPropertyDefinition";
type MethodDefinitionKind = "constructor" | "method" | "get" | "set";
interface PrivateIdentifier extends Span {
  type: "PrivateIdentifier";
  name: string;
  parent?: Node;
}
interface StaticBlock extends Span {
  type: "StaticBlock";
  body: Array<Statement>;
  parent?: Node;
}
type ModuleDeclaration = ImportDeclaration | ExportAllDeclaration | ExportDefaultDeclaration | ExportNamedDeclaration | TSExportAssignment | TSNamespaceExportDeclaration;
type AccessorPropertyType = "AccessorProperty" | "TSAbstractAccessorProperty";
interface AccessorProperty extends Span {
  type: AccessorPropertyType;
  decorators: Array<Decorator>;
  key: PropertyKey;
  typeAnnotation?: TSTypeAnnotation | null;
  value: Expression | null;
  computed: boolean;
  static: boolean;
  override?: boolean;
  definite?: boolean;
  accessibility?: TSAccessibility | null;
  declare?: false;
  optional?: false;
  readonly?: false;
  parent?: Node;
}
interface ImportExpression extends Span {
  type: "ImportExpression";
  source: Expression;
  options: Expression | null;
  phase: ImportPhase | null;
  parent?: Node;
}
interface ImportDeclaration extends Span {
  type: "ImportDeclaration";
  specifiers: Array<ImportDeclarationSpecifier>;
  source: StringLiteral;
  phase: ImportPhase | null;
  attributes: Array<ImportAttribute>;
  importKind?: ImportOrExportKind;
  parent?: Node;
}
type ImportPhase = "source" | "defer";
type ImportDeclarationSpecifier = ImportSpecifier | ImportDefaultSpecifier | ImportNamespaceSpecifier;
interface ImportSpecifier extends Span {
  type: "ImportSpecifier";
  imported: ModuleExportName;
  local: BindingIdentifier;
  importKind?: ImportOrExportKind;
  parent?: Node;
}
interface ImportDefaultSpecifier extends Span {
  type: "ImportDefaultSpecifier";
  local: BindingIdentifier;
  parent?: Node;
}
interface ImportNamespaceSpecifier extends Span {
  type: "ImportNamespaceSpecifier";
  local: BindingIdentifier;
  parent?: Node;
}
interface ImportAttribute extends Span {
  type: "ImportAttribute";
  key: ImportAttributeKey;
  value: StringLiteral;
  parent?: Node;
}
type ImportAttributeKey = IdentifierName | StringLiteral;
interface ExportNamedDeclaration extends Span {
  type: "ExportNamedDeclaration";
  declaration: Declaration | null;
  specifiers: Array<ExportSpecifier>;
  source: StringLiteral | null;
  exportKind?: ImportOrExportKind;
  attributes: Array<ImportAttribute>;
  parent?: Node;
}
interface ExportDefaultDeclaration extends Span {
  type: "ExportDefaultDeclaration";
  declaration: ExportDefaultDeclarationKind;
  exportKind?: "value";
  parent?: Node;
}
interface ExportAllDeclaration extends Span {
  type: "ExportAllDeclaration";
  exported: ModuleExportName | null;
  source: StringLiteral;
  attributes: Array<ImportAttribute>;
  exportKind?: ImportOrExportKind;
  parent?: Node;
}
interface ExportSpecifier extends Span {
  type: "ExportSpecifier";
  local: ModuleExportName;
  exported: ModuleExportName;
  exportKind?: ImportOrExportKind;
  parent?: Node;
}
type ExportDefaultDeclarationKind = Function | Class | TSInterfaceDeclaration | Expression;
type ModuleExportName = IdentifierName | IdentifierReference | StringLiteral;
interface V8IntrinsicExpression extends Span {
  type: "V8IntrinsicExpression";
  name: IdentifierName;
  arguments: Array<Argument>;
  parent?: Node;
}
interface BooleanLiteral extends Span {
  type: "Literal";
  value: boolean;
  raw: string | null;
  parent?: Node;
}
interface NullLiteral extends Span {
  type: "Literal";
  value: null;
  raw: "null" | null;
  parent?: Node;
}
interface NumericLiteral extends Span {
  type: "Literal";
  value: number;
  raw: string | null;
  parent?: Node;
}
interface StringLiteral extends Span {
  type: "Literal";
  value: string;
  raw: string | null;
  parent?: Node;
}
interface BigIntLiteral extends Span {
  type: "Literal";
  value: bigint;
  raw: string | null;
  bigint: string;
  parent?: Node;
}
interface RegExpLiteral extends Span {
  type: "Literal";
  value: RegExp | null;
  raw: string | null;
  regex: {
    pattern: string;
    flags: string;
  };
  parent?: Node;
}
interface JSXElement extends Span {
  type: "JSXElement";
  openingElement: JSXOpeningElement;
  children: Array<JSXChild>;
  closingElement: JSXClosingElement | null;
  parent?: Node;
}
interface JSXOpeningElement extends Span {
  type: "JSXOpeningElement";
  name: JSXElementName;
  typeArguments?: TSTypeParameterInstantiation | null;
  attributes: Array<JSXAttributeItem>;
  selfClosing: boolean;
  parent?: Node;
}
interface JSXClosingElement extends Span {
  type: "JSXClosingElement";
  name: JSXElementName;
  parent?: Node;
}
interface JSXFragment extends Span {
  type: "JSXFragment";
  openingFragment: JSXOpeningFragment;
  children: Array<JSXChild>;
  closingFragment: JSXClosingFragment;
  parent?: Node;
}
interface JSXOpeningFragment extends Span {
  type: "JSXOpeningFragment";
  attributes?: [];
  selfClosing?: false;
  parent?: Node;
}
interface JSXClosingFragment extends Span {
  type: "JSXClosingFragment";
  parent?: Node;
}
type JSXElementName = JSXIdentifier | JSXNamespacedName | JSXMemberExpression;
interface JSXNamespacedName extends Span {
  type: "JSXNamespacedName";
  namespace: JSXIdentifier;
  name: JSXIdentifier;
  parent?: Node;
}
interface JSXMemberExpression extends Span {
  type: "JSXMemberExpression";
  object: JSXMemberExpressionObject;
  property: JSXIdentifier;
  parent?: Node;
}
type JSXMemberExpressionObject = JSXIdentifier | JSXMemberExpression;
interface JSXExpressionContainer extends Span {
  type: "JSXExpressionContainer";
  expression: JSXExpression;
  parent?: Node;
}
type JSXExpression = JSXEmptyExpression | Expression;
interface JSXEmptyExpression extends Span {
  type: "JSXEmptyExpression";
  parent?: Node;
}
type JSXAttributeItem = JSXAttribute | JSXSpreadAttribute;
interface JSXAttribute extends Span {
  type: "JSXAttribute";
  name: JSXAttributeName;
  value: JSXAttributeValue | null;
  parent?: Node;
}
interface JSXSpreadAttribute extends Span {
  type: "JSXSpreadAttribute";
  argument: Expression;
  parent?: Node;
}
type JSXAttributeName = JSXIdentifier | JSXNamespacedName;
type JSXAttributeValue = StringLiteral | JSXExpressionContainer | JSXElement | JSXFragment;
interface JSXIdentifier extends Span {
  type: "JSXIdentifier";
  name: string;
  parent?: Node;
}
type JSXChild = JSXText | JSXElement | JSXFragment | JSXExpressionContainer | JSXSpreadChild;
interface JSXSpreadChild extends Span {
  type: "JSXSpreadChild";
  expression: Expression;
  parent?: Node;
}
interface JSXText extends Span {
  type: "JSXText";
  value: string;
  raw: string | null;
  parent?: Node;
}
interface TSThisParameter extends Span {
  type: "Identifier";
  decorators: [];
  name: "this";
  optional: false;
  typeAnnotation: TSTypeAnnotation | null;
  parent?: Node;
}
interface TSEnumDeclaration extends Span {
  type: "TSEnumDeclaration";
  id: BindingIdentifier;
  body: TSEnumBody;
  const: boolean;
  declare: boolean;
  parent?: Node;
}
interface TSEnumBody extends Span {
  type: "TSEnumBody";
  members: Array<TSEnumMember>;
  parent?: Node;
}
interface TSEnumMember extends Span {
  type: "TSEnumMember";
  id: TSEnumMemberName;
  initializer: Expression | null;
  computed: boolean;
  parent?: Node;
}
type TSEnumMemberName = IdentifierName | StringLiteral | TemplateLiteral;
interface TSTypeAnnotation extends Span {
  type: "TSTypeAnnotation";
  typeAnnotation: TSType;
  parent?: Node;
}
interface TSLiteralType extends Span {
  type: "TSLiteralType";
  literal: TSLiteral;
  parent?: Node;
}
type TSLiteral = BooleanLiteral | NumericLiteral | BigIntLiteral | StringLiteral | TemplateLiteral | UnaryExpression;
type TSType = TSAnyKeyword | TSBigIntKeyword | TSBooleanKeyword | TSIntrinsicKeyword | TSNeverKeyword | TSNullKeyword | TSNumberKeyword | TSObjectKeyword | TSStringKeyword | TSSymbolKeyword | TSUndefinedKeyword | TSUnknownKeyword | TSVoidKeyword | TSArrayType | TSConditionalType | TSConstructorType | TSFunctionType | TSImportType | TSIndexedAccessType | TSInferType | TSIntersectionType | TSLiteralType | TSMappedType | TSNamedTupleMember | TSTemplateLiteralType | TSThisType | TSTupleType | TSTypeLiteral | TSTypeOperator | TSTypePredicate | TSTypeQuery | TSTypeReference | TSUnionType | TSParenthesizedType | JSDocNullableType | JSDocNonNullableType | JSDocUnknownType;
interface TSConditionalType extends Span {
  type: "TSConditionalType";
  checkType: TSType;
  extendsType: TSType;
  trueType: TSType;
  falseType: TSType;
  parent?: Node;
}
interface TSUnionType extends Span {
  type: "TSUnionType";
  types: Array<TSType>;
  parent?: Node;
}
interface TSIntersectionType extends Span {
  type: "TSIntersectionType";
  types: Array<TSType>;
  parent?: Node;
}
interface TSParenthesizedType extends Span {
  type: "TSParenthesizedType";
  typeAnnotation: TSType;
  parent?: Node;
}
interface TSTypeOperator extends Span {
  type: "TSTypeOperator";
  operator: TSTypeOperatorOperator;
  typeAnnotation: TSType;
  parent?: Node;
}
type TSTypeOperatorOperator = "keyof" | "unique" | "readonly";
interface TSArrayType extends Span {
  type: "TSArrayType";
  elementType: TSType;
  parent?: Node;
}
interface TSIndexedAccessType extends Span {
  type: "TSIndexedAccessType";
  objectType: TSType;
  indexType: TSType;
  parent?: Node;
}
interface TSTupleType extends Span {
  type: "TSTupleType";
  elementTypes: Array<TSTupleElement>;
  parent?: Node;
}
interface TSNamedTupleMember extends Span {
  type: "TSNamedTupleMember";
  label: IdentifierName;
  elementType: TSTupleElement;
  optional: boolean;
  parent?: Node;
}
interface TSOptionalType extends Span {
  type: "TSOptionalType";
  typeAnnotation: TSType;
  parent?: Node;
}
interface TSRestType extends Span {
  type: "TSRestType";
  typeAnnotation: TSType;
  parent?: Node;
}
type TSTupleElement = TSOptionalType | TSRestType | TSType;
interface TSAnyKeyword extends Span {
  type: "TSAnyKeyword";
  parent?: Node;
}
interface TSStringKeyword extends Span {
  type: "TSStringKeyword";
  parent?: Node;
}
interface TSBooleanKeyword extends Span {
  type: "TSBooleanKeyword";
  parent?: Node;
}
interface TSNumberKeyword extends Span {
  type: "TSNumberKeyword";
  parent?: Node;
}
interface TSNeverKeyword extends Span {
  type: "TSNeverKeyword";
  parent?: Node;
}
interface TSIntrinsicKeyword extends Span {
  type: "TSIntrinsicKeyword";
  parent?: Node;
}
interface TSUnknownKeyword extends Span {
  type: "TSUnknownKeyword";
  parent?: Node;
}
interface TSNullKeyword extends Span {
  type: "TSNullKeyword";
  parent?: Node;
}
interface TSUndefinedKeyword extends Span {
  type: "TSUndefinedKeyword";
  parent?: Node;
}
interface TSVoidKeyword extends Span {
  type: "TSVoidKeyword";
  parent?: Node;
}
interface TSSymbolKeyword extends Span {
  type: "TSSymbolKeyword";
  parent?: Node;
}
interface TSThisType extends Span {
  type: "TSThisType";
  parent?: Node;
}
interface TSObjectKeyword extends Span {
  type: "TSObjectKeyword";
  parent?: Node;
}
interface TSBigIntKeyword extends Span {
  type: "TSBigIntKeyword";
  parent?: Node;
}
interface TSTypeReference extends Span {
  type: "TSTypeReference";
  typeName: TSTypeName;
  typeArguments: TSTypeParameterInstantiation | null;
  parent?: Node;
}
type TSTypeName = IdentifierReference | TSQualifiedName | ThisExpression;
interface TSQualifiedName extends Span {
  type: "TSQualifiedName";
  left: TSTypeName;
  right: IdentifierName;
  parent?: Node;
}
interface TSTypeParameterInstantiation extends Span {
  type: "TSTypeParameterInstantiation";
  params: Array<TSType>;
  parent?: Node;
}
interface TSTypeParameter extends Span {
  type: "TSTypeParameter";
  name: BindingIdentifier;
  constraint: TSType | null;
  default: TSType | null;
  in: boolean;
  out: boolean;
  const: boolean;
  parent?: Node;
}
interface TSTypeParameterDeclaration extends Span {
  type: "TSTypeParameterDeclaration";
  params: Array<TSTypeParameter>;
  parent?: Node;
}
interface TSTypeAliasDeclaration extends Span {
  type: "TSTypeAliasDeclaration";
  id: BindingIdentifier;
  typeParameters: TSTypeParameterDeclaration | null;
  typeAnnotation: TSType;
  declare: boolean;
  parent?: Node;
}
type TSAccessibility = "private" | "protected" | "public";
interface TSClassImplements extends Span {
  type: "TSClassImplements";
  expression: IdentifierReference | ThisExpression | MemberExpression;
  typeArguments: TSTypeParameterInstantiation | null;
  parent?: Node;
}
interface TSInterfaceDeclaration extends Span {
  type: "TSInterfaceDeclaration";
  id: BindingIdentifier;
  typeParameters: TSTypeParameterDeclaration | null;
  extends: Array<TSInterfaceHeritage>;
  body: TSInterfaceBody;
  declare: boolean;
  parent?: Node;
}
interface TSInterfaceBody extends Span {
  type: "TSInterfaceBody";
  body: Array<TSSignature>;
  parent?: Node;
}
interface TSPropertySignature extends Span {
  type: "TSPropertySignature";
  computed: boolean;
  optional: boolean;
  readonly: boolean;
  key: PropertyKey;
  typeAnnotation: TSTypeAnnotation | null;
  accessibility: null;
  static: false;
  parent?: Node;
}
type TSSignature = TSIndexSignature | TSPropertySignature | TSCallSignatureDeclaration | TSConstructSignatureDeclaration | TSMethodSignature;
interface TSIndexSignature extends Span {
  type: "TSIndexSignature";
  parameters: Array<TSIndexSignatureName>;
  typeAnnotation: TSTypeAnnotation;
  readonly: boolean;
  static: boolean;
  accessibility: null;
  parent?: Node;
}
interface TSCallSignatureDeclaration extends Span {
  type: "TSCallSignatureDeclaration";
  typeParameters: TSTypeParameterDeclaration | null;
  params: ParamPattern[];
  returnType: TSTypeAnnotation | null;
  parent?: Node;
}
type TSMethodSignatureKind = "method" | "get" | "set";
interface TSMethodSignature extends Span {
  type: "TSMethodSignature";
  key: PropertyKey;
  computed: boolean;
  optional: boolean;
  kind: TSMethodSignatureKind;
  typeParameters: TSTypeParameterDeclaration | null;
  params: ParamPattern[];
  returnType: TSTypeAnnotation | null;
  accessibility: null;
  readonly: false;
  static: false;
  parent?: Node;
}
interface TSConstructSignatureDeclaration extends Span {
  type: "TSConstructSignatureDeclaration";
  typeParameters: TSTypeParameterDeclaration | null;
  params: ParamPattern[];
  returnType: TSTypeAnnotation | null;
  parent?: Node;
}
interface TSIndexSignatureName extends Span {
  type: "Identifier";
  decorators: [];
  name: string;
  optional: false;
  typeAnnotation: TSTypeAnnotation;
  parent?: Node;
}
interface TSInterfaceHeritage extends Span {
  type: "TSInterfaceHeritage";
  expression: Expression;
  typeArguments: TSTypeParameterInstantiation | null;
  parent?: Node;
}
interface TSTypePredicate extends Span {
  type: "TSTypePredicate";
  parameterName: TSTypePredicateName;
  asserts: boolean;
  typeAnnotation: TSTypeAnnotation | null;
  parent?: Node;
}
type TSTypePredicateName = IdentifierName | TSThisType;
interface TSModuleDeclaration extends Span {
  type: "TSModuleDeclaration";
  id: BindingIdentifier | StringLiteral | TSQualifiedName;
  body: TSModuleBlock | null;
  kind: TSModuleDeclarationKind;
  declare: boolean;
  global: false;
  parent?: Node;
}
type TSModuleDeclarationKind = "module" | "namespace";
interface TSGlobalDeclaration extends Span {
  type: "TSModuleDeclaration";
  id: IdentifierName;
  body: TSModuleBlock;
  kind: "global";
  declare: boolean;
  global: true;
  parent?: Node;
}
interface TSModuleBlock extends Span {
  type: "TSModuleBlock";
  body: Array<Directive | Statement>;
  parent?: Node;
}
interface TSTypeLiteral extends Span {
  type: "TSTypeLiteral";
  members: Array<TSSignature>;
  parent?: Node;
}
interface TSInferType extends Span {
  type: "TSInferType";
  typeParameter: TSTypeParameter;
  parent?: Node;
}
interface TSTypeQuery extends Span {
  type: "TSTypeQuery";
  exprName: TSTypeQueryExprName;
  typeArguments: TSTypeParameterInstantiation | null;
  parent?: Node;
}
type TSTypeQueryExprName = TSImportType | TSTypeName;
interface TSImportType extends Span {
  type: "TSImportType";
  source: StringLiteral;
  options: ObjectExpression | null;
  qualifier: TSImportTypeQualifier | null;
  typeArguments: TSTypeParameterInstantiation | null;
  parent?: Node;
}
type TSImportTypeQualifier = IdentifierName | TSImportTypeQualifiedName;
interface TSImportTypeQualifiedName extends Span {
  type: "TSQualifiedName";
  left: TSImportTypeQualifier;
  right: IdentifierName;
  parent?: Node;
}
interface TSFunctionType extends Span {
  type: "TSFunctionType";
  typeParameters: TSTypeParameterDeclaration | null;
  params: ParamPattern[];
  returnType: TSTypeAnnotation;
  parent?: Node;
}
interface TSConstructorType extends Span {
  type: "TSConstructorType";
  abstract: boolean;
  typeParameters: TSTypeParameterDeclaration | null;
  params: ParamPattern[];
  returnType: TSTypeAnnotation;
  parent?: Node;
}
interface TSMappedType extends Span {
  type: "TSMappedType";
  key: BindingIdentifier;
  constraint: TSType;
  nameType: TSType | null;
  typeAnnotation: TSType | null;
  optional: TSMappedTypeModifierOperator | false;
  readonly: TSMappedTypeModifierOperator | null;
  parent?: Node;
}
type TSMappedTypeModifierOperator = true | "+" | "-";
interface TSTemplateLiteralType extends Span {
  type: "TSTemplateLiteralType";
  quasis: Array<TemplateElement>;
  types: Array<TSType>;
  parent?: Node;
}
interface TSAsExpression extends Span {
  type: "TSAsExpression";
  expression: Expression;
  typeAnnotation: TSType;
  parent?: Node;
}
interface TSSatisfiesExpression extends Span {
  type: "TSSatisfiesExpression";
  expression: Expression;
  typeAnnotation: TSType;
  parent?: Node;
}
interface TSTypeAssertion extends Span {
  type: "TSTypeAssertion";
  typeAnnotation: TSType;
  expression: Expression;
  parent?: Node;
}
interface TSImportEqualsDeclaration extends Span {
  type: "TSImportEqualsDeclaration";
  id: BindingIdentifier;
  moduleReference: TSModuleReference;
  importKind: ImportOrExportKind;
  parent?: Node;
}
type TSModuleReference = TSExternalModuleReference | IdentifierReference | TSQualifiedName;
interface TSExternalModuleReference extends Span {
  type: "TSExternalModuleReference";
  expression: StringLiteral;
  parent?: Node;
}
interface TSNonNullExpression extends Span {
  type: "TSNonNullExpression";
  expression: Expression;
  parent?: Node;
}
interface Decorator extends Span {
  type: "Decorator";
  expression: Expression;
  parent?: Node;
}
interface TSExportAssignment extends Span {
  type: "TSExportAssignment";
  expression: Expression;
  parent?: Node;
}
interface TSNamespaceExportDeclaration extends Span {
  type: "TSNamespaceExportDeclaration";
  id: IdentifierName;
  parent?: Node;
}
interface TSInstantiationExpression extends Span {
  type: "TSInstantiationExpression";
  expression: Expression;
  typeArguments: TSTypeParameterInstantiation;
  parent?: Node;
}
type ImportOrExportKind = "value" | "type";
interface JSDocNullableType extends Span {
  type: "TSJSDocNullableType";
  typeAnnotation: TSType;
  postfix: boolean;
  parent?: Node;
}
interface JSDocNonNullableType extends Span {
  type: "TSJSDocNonNullableType";
  typeAnnotation: TSType;
  postfix: boolean;
  parent?: Node;
}
interface JSDocUnknownType extends Span {
  type: "TSJSDocUnknownType";
  parent?: Node;
}
type AssignmentOperator = "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "**=" | "<<=" | ">>=" | ">>>=" | "|=" | "^=" | "&=" | "||=" | "&&=" | "??=";
type BinaryOperator = "==" | "!=" | "===" | "!==" | "<" | "<=" | ">" | ">=" | "+" | "-" | "*" | "/" | "%" | "**" | "<<" | ">>" | ">>>" | "|" | "^" | "&" | "in" | "instanceof";
type LogicalOperator = "||" | "&&" | "??";
type UnaryOperator = "+" | "-" | "!" | "~" | "typeof" | "void" | "delete";
type UpdateOperator = "++" | "--";
interface Span {
  start: number;
  end: number;
  range?: [number, number];
}
type ModuleKind = "script" | "module" | "commonjs";
type Node = Program | IdentifierName | IdentifierReference | BindingIdentifier | LabelIdentifier | ThisExpression | ArrayExpression | ObjectExpression | ObjectProperty | TemplateLiteral | TaggedTemplateExpression | TemplateElement | ComputedMemberExpression | StaticMemberExpression | PrivateFieldExpression | CallExpression | NewExpression | MetaProperty | SpreadElement | UpdateExpression | UnaryExpression | BinaryExpression | PrivateInExpression | LogicalExpression | ConditionalExpression | AssignmentExpression | ArrayAssignmentTarget | ObjectAssignmentTarget | AssignmentTargetRest | AssignmentTargetWithDefault | AssignmentTargetPropertyIdentifier | AssignmentTargetPropertyProperty | SequenceExpression | Super | AwaitExpression | ChainExpression | ParenthesizedExpression | Directive | Hashbang | BlockStatement | VariableDeclaration | VariableDeclarator | EmptyStatement | ExpressionStatement | IfStatement | DoWhileStatement | WhileStatement | ForStatement | ForInStatement | ForOfStatement | ContinueStatement | BreakStatement | ReturnStatement | WithStatement | SwitchStatement | SwitchCase | LabeledStatement | ThrowStatement | TryStatement | CatchClause | DebuggerStatement | AssignmentPattern | ObjectPattern | BindingProperty | ArrayPattern | BindingRestElement | Function | FunctionBody | ArrowFunctionExpression | YieldExpression | Class | ClassBody | MethodDefinition | PropertyDefinition | PrivateIdentifier | StaticBlock | AccessorProperty | ImportExpression | ImportDeclaration | ImportSpecifier | ImportDefaultSpecifier | ImportNamespaceSpecifier | ImportAttribute | ExportNamedDeclaration | ExportDefaultDeclaration | ExportAllDeclaration | ExportSpecifier | V8IntrinsicExpression | BooleanLiteral | NullLiteral | NumericLiteral | StringLiteral | BigIntLiteral | RegExpLiteral | JSXElement | JSXOpeningElement | JSXClosingElement | JSXFragment | JSXOpeningFragment | JSXClosingFragment | JSXNamespacedName | JSXMemberExpression | JSXExpressionContainer | JSXEmptyExpression | JSXAttribute | JSXSpreadAttribute | JSXIdentifier | JSXSpreadChild | JSXText | TSThisParameter | TSEnumDeclaration | TSEnumBody | TSEnumMember | TSTypeAnnotation | TSLiteralType | TSConditionalType | TSUnionType | TSIntersectionType | TSParenthesizedType | TSTypeOperator | TSArrayType | TSIndexedAccessType | TSTupleType | TSNamedTupleMember | TSOptionalType | TSRestType | TSAnyKeyword | TSStringKeyword | TSBooleanKeyword | TSNumberKeyword | TSNeverKeyword | TSIntrinsicKeyword | TSUnknownKeyword | TSNullKeyword | TSUndefinedKeyword | TSVoidKeyword | TSSymbolKeyword | TSThisType | TSObjectKeyword | TSBigIntKeyword | TSTypeReference | TSQualifiedName | TSTypeParameterInstantiation | TSTypeParameter | TSTypeParameterDeclaration | TSTypeAliasDeclaration | TSClassImplements | TSInterfaceDeclaration | TSInterfaceBody | TSPropertySignature | TSIndexSignature | TSCallSignatureDeclaration | TSMethodSignature | TSConstructSignatureDeclaration | TSIndexSignatureName | TSInterfaceHeritage | TSTypePredicate | TSModuleDeclaration | TSGlobalDeclaration | TSModuleBlock | TSTypeLiteral | TSInferType | TSTypeQuery | TSImportType | TSImportTypeQualifiedName | TSFunctionType | TSConstructorType | TSMappedType | TSTemplateLiteralType | TSAsExpression | TSSatisfiesExpression | TSTypeAssertion | TSImportEqualsDeclaration | TSExternalModuleReference | TSNonNullExpression | Decorator | TSExportAssignment | TSNamespaceExportDeclaration | TSInstantiationExpression | JSDocNullableType | JSDocNonNullableType | JSDocUnknownType | ParamPattern;
//#endregion
export { Program as t };