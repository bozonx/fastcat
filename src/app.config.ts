export default defineAppConfig({
  ui: {
    colors: {
      primary: 'indigo',
      neutral: 'zinc',
    },
    icons: {
      loading: 'i-lucide-loader-circle',
      close: 'i-lucide-x',
      check: 'i-lucide-check',
      chevronDown: 'i-lucide-chevron-down',
    },
    button: {
      slots: {
        base: 'font-medium rounded-[var(--radius-ui-md)]',
      },
      defaultVariants: {
        color: 'neutral',
        variant: 'outline',
        size: 'sm',
      },
    },
    input: {
      slots: {
        base: 'rounded-[var(--radius-ui-md)]',
      },
      defaultVariants: {
        size: 'sm',
        variant: 'outline',
      },
    },
    textarea: {
      slots: {
        base: 'rounded-[var(--radius-ui-md)]',
      },
      defaultVariants: {
        size: 'sm',
        variant: 'outline',
      },
    },
    select: {
      slots: {
        base: 'rounded-[var(--radius-ui-md)]',
      },
      defaultVariants: {
        size: 'sm',
        variant: 'outline',
      },
    },
    formField: {
      slots: {
        root: 'gap-1.5',
        label: 'text-xs font-medium text-ui-text',
        description: 'text-xs text-ui-text-muted',
        error: 'text-xs',
      },
    },
    modal: {
      slots: {
        overlay: 'bg-black/70 backdrop-blur-sm',
      },
    },
    toast: {
      slots: {
        title: 'select-text',
        description: 'select-text',
      },
    },
  },
});
