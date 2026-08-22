/**
 * How Clerk's own widgets are dressed so they read as part of this site.
 *
 * `app/(app)/sign-in-gate.tsx` explains why almost nothing else in the shell is a
 * Clerk component: `<UserButton />` and friends bring their own radius ladder and
 * their own soft shadows, and this design system is 1px ink borders, hard
 * zero-blur offset shadows and radius 0 (`docs/DESIGN.md` §5, §11), so a rounded
 * card dropped into it reads as a third-party bolt-on. The sign-in *page* is the
 * one place that argument runs the other way. Re-implementing email codes, OAuth
 * buttons, password reset and multi-factor against Clerk's headless API would be
 * a login form we wrote ourselves — which is the single worst place in a product
 * to have written something ourselves — so here the widget is the whole content
 * and gets themed once, in this file.
 *
 * ## Why the values are `var(--…)` rather than colours
 *
 * Clerk's `<SignIn />` renders into the page's own DOM rather than an iframe, so a
 * CSS custom property declared on `:root` resolves inside it. That matters more
 * than it saves in typing: `app/globals.css` defines the palette twice, once per
 * theme, and it is the *only* place either theme is written down — the rule stated
 * at the top of that file is semantic tokens only, both themes at the token layer,
 * no `dark:` in components. Naming a hex here would pin the widget to one theme
 * and would be a second copy of a colour that moves. This way the sign-in card
 * follows the theme toggle for free, including the `prefers-color-scheme` default.
 *
 * `borderRadius: '0px'` and the hard shadow on the card are the two things that
 * actually do the work of making it look like ours; everything else is colour.
 */

/**
 * Typed structurally rather than as Clerk's `Appearance`.
 *
 * The import would have to be a value-position one from `@clerk/nextjs` (Clerk
 * re-exports the type but not from a subpath that is safe to reach from a module
 * a self-hosted build also loads), and this file is imported by two pages that
 * must be able to render `notFound()` on a checkout where `@clerk/nextjs` is
 * never evaluated. The object is handed straight to a `<SignIn>`/`<SignUp>` prop,
 * so it is checked against the SDK's real prop type at the point of use — which
 * is where a mismatch would matter.
 */
export type ClerkAppearance = {
  variables: Record<string, string>;
  elements: Record<string, string>;
};

export const CLERK_APPEARANCE: ClerkAppearance = {
  variables: {
    colorPrimary: 'var(--accent)',
    colorBackground: 'var(--card)',
    colorText: 'var(--foreground)',
    colorTextSecondary: 'var(--muted-foreground)',
    colorInputBackground: 'var(--background)',
    colorInputText: 'var(--foreground)',
    colorDanger: 'var(--destructive)',
    borderRadius: '0px',
    fontFamily: 'var(--font-sans)',
  },
  elements: {
    // The card carries the border and the hard offset shadow itself rather than
    // being wrapped in one of ours: a bordered box inside a bordered box is the
    // double-frame this system's §5 specifically rules out.
    card: 'border border-border shadow-card',
    // Clerk's footer is a "Secured by Clerk" badge and a development-mode banner.
    // Both stay — hiding the badge is against Clerk's terms on the free tier, and
    // hiding the development banner would remove the one visible signal that a
    // deployment is pointed at a test instance.
    headerTitle: 'tracking-tight',
    formButtonPrimary: 'shadow-none',
  },
};
