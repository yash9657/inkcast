export type ClerkAppearance = {
  variables: Record<string, string>;
  elements: Record<string, string>;
};

/**
 * Clerk's widget, dressed in the "ink, paper, highlighter" tokens. Every value
 * is a CSS variable, so the widget follows the theme toggle without a reload.
 */
export const CLERK_APPEARANCE: ClerkAppearance = {
  variables: {
    colorPrimary: 'var(--primary)',
    colorTextOnPrimaryBackground: 'var(--primary-foreground)',
    colorBackground: 'var(--card)',
    colorText: 'var(--foreground)',
    colorTextSecondary: 'var(--muted-foreground)',
    colorInputBackground: 'var(--card)',
    colorInputText: 'var(--foreground)',
    colorNeutral: 'var(--foreground)',
    colorDanger: 'var(--destructive)',
    colorSuccess: 'var(--success)',
    colorWarning: 'var(--warning)',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-sans)',
    fontFamilyButtons: 'var(--font-sans)',
  },
  elements: {
    // The card carries the border itself rather than being wrapped in one of
    // ours: a bordered box inside a bordered box is a double frame.
    // Clerk's footer ("Secured by Clerk", the development banner) stays — hiding
    // the badge is against Clerk's free-tier terms, and the banner is the one
    // visible signal that a deployment points at a test instance.
    card: 'rounded-xl border border-border shadow-pop',
    headerTitle: 'font-display text-2xl font-normal tracking-tight',
    formButtonPrimary: 'rounded-pill shadow-none normal-case text-sm font-medium',
    socialButtonsBlockButton: 'rounded-pill border-border',
    formFieldInput: 'border-input',
    footerActionLink: 'text-link underline underline-offset-4',
  },
};
