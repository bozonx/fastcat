export function initTransitions(): void {
  // Built-in transitions live in the runtime-agnostic manifest catalog.
  // The registry remains available for custom plugin transitions.
}

export * from './core/registry';
export * from './manifests';
