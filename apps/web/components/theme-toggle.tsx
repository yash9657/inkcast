/**
 * The theme control, re-exported for pages and chrome outside `components/ui`.
 *
 * There is deliberately no second implementation here. `components/ui/theme-toggle.tsx`
 * (owned by the design system) already ships the three-way light/dark/system
 * control listed in docs/DESIGN.md §7, including the pre-mount reserved box that
 * stops the header shifting when it hydrates. Duplicating it would create a
 * second source of truth for a control that appears in both the header and the
 * footer, so this module is a re-export and nothing more.
 */
export { ThemeToggle } from '@/components/ui/theme-toggle';
