export default defineAppConfig({
  ui: {
    colors: {
      primary: 'zinc',
      neutral: 'zinc',
      red: 'red',
      green: 'green',
      amber: 'amber',
      blue: 'blue',
      yellow: 'yellow',
      success: 'green',
      warning: 'amber',
    },
    icons: {
      loading: 'i-lucide-loader-circle',
      close: 'i-lucide-x',
      check: 'i-lucide-check',
      chevronDown: 'i-lucide-chevron-down',
    },
    dropdownMenu: {
      slots: {
        content: 'min-w-44',
        item: 'text-sm',
        itemLeadingIcon: 'size-4',
      },
    },
    contextMenu: {
      slots: {
        content: 'min-w-44',
        item: 'text-sm',
        itemLeadingIcon: 'size-4',
      },
    },
    selectMenu: {
      slots: {
        content: 'min-w-44',
        item: 'text-sm',
        itemLeadingIcon: 'size-4',
      },
    },
    button: {
      slots: {
        base: 'font-medium rounded-[var(--radius-ui-md)] transition-colors duration-150',
      },
      defaultVariants: {
        color: 'neutral',
        variant: 'outline',
        size: 'sm',
      },
      compoundVariants: [
        {
          color: 'primary',
          variant: 'solid',
          class:
            'bg-zinc-300 text-zinc-950 hover:bg-zinc-400 active:bg-zinc-500 dark:bg-zinc-600 dark:text-zinc-50 dark:hover:bg-zinc-500 dark:active:bg-zinc-400 font-semibold shadow-sm disabled:bg-zinc-800/40 disabled:text-zinc-500 disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed',
        },
      ],
    },
    input: {
      slots: {
        base: 'font-mono text-2xs rounded-sm',
      },
      variants: {
        size: {
          xs: {
            base: 'leading-8 py-0 md:leading-8',
          },
        },
      },
      defaultVariants: {
        size: 'xs',
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
        base: 'text-2xs rounded-sm',
      },
      defaultVariants: {
        size: 'xs',
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
    checkbox: {
      slots: {
        base: 'rounded-sm border border-ui-border overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 cursor-pointer',
        label: 'cursor-pointer select-none',
      },
    },
    modal: {
      slots: {
        overlay: 'bg-black/70 backdrop-blur-sm',
      },
    },
    tooltip: {
      slots: {
        content: 'z-[var(--z-tooltip)]',
      },
    },
    toast: {
      slots: {
        title: 'select-text',
        description: 'select-text',
      },
    },
    toaster: {
      slots: {
        // Default viewport sits at z-[100], below every modal (1050) and drawer
        // (1030), so toasts raised from inside a modal render under its overlay.
        // Lift it above the modal/tooltip layers so notifications stay visible.
        viewport: 'z-[var(--z-toast)]',
      },
    },
  },
});
