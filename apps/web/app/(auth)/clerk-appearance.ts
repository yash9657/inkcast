export type ClerkAppearance = {
  variables: Record<string, string>;
  elements: Record<string, string>;
};

export const CLERK_APPEARANCE: ClerkAppearance = {
  variables: {
    colorPrimary: 'var(--primary)',
    colorBackground: 'var(--card)',
    colorText: 'var(--foreground)',
    colorTextSecondary: 'var(--muted-foreground)',
    colorInputBackground: 'var(--background)',
    colorInputText: 'var(--foreground)',
    colorDanger: 'var(--destructive)',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-sans)',
  },
  elements: {
    // The card carries the border and the hard offset shadow itself rather than
    // being wrapped in one of ours: a bordered box inside a bordered box is the
    // double-frame this system's §5 specifically rules out.
    card: 'rounded-xl border border-border shadow-none',
    // Clerk's footer is a "Secured by Clerk" badge and a development-mode banner.
    // Both stay — hiding the badge is against Clerk's terms on the free tier, and
    // hiding the development banner would remove the one visible signal that a
    // deployment is pointed at a test instance.
    headerTitle: 'tracking-tight',
    formButtonPrimary: 'shadow-none',
  },
};
