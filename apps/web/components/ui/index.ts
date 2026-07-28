/**
 * The primitive surface. Import from here:
 *
 *   import { Button, Card, CardHeader, toast } from '@/components/ui';
 *
 * Everything the rest of the app is built from is in this barrel. If a screen
 * needs something that is not here, the answer is a new primitive in this
 * directory — not a bespoke div with hand-picked classes in a page file.
 *
 * See docs/DESIGN.md for the full inventory, props and usage rules.
 */

export { Badge, badgeVariants, StatusDot, type BadgeProps } from './badge';
export { Button, buttonVariants, type ButtonProps } from './button';
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardInteractive,
  CardTitle,
} from './card';
export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPrimitive,
  CommandSeparator,
  CommandShortcut,
  type CommandDialogProps,
} from './command';
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';
export {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  type DrawerContentProps,
} from './drawer';
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  type DropdownMenuItemProps,
} from './dropdown-menu';
export { GithubIcon, type IconProps } from './icons';
export {
  InkArrow,
  InkBoard,
  InkCircle,
  InkHighlight,
  InkUnderline,
  inkCirclePath,
  inkStrokePath,
  inkToneFill,
  inkToneStroke,
  type InkTone,
} from './ink';
export { Input, type InputProps } from './input';
export { Kbd } from './kbd';
export { Label, LabelError, LabelHint } from './label';
export { Progress, type ProgressProps } from './progress';
export { defaultSpring, Providers } from './providers';
export { ScrollArea, type ScrollAreaProps } from './scroll-area';
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './select';
export { Separator, SeparatorLabelled } from './separator';
export { Skeleton, SkeletonText } from './skeleton';
export { Slider, type SliderProps } from './slider';
export { Toaster, toast } from './sonner';
export { Switch } from './switch';
export { Tabs, TabsList, TabsPanel, TabsTab } from './tabs';
export { Textarea } from './textarea';
export { ThemeToggle } from './theme-toggle';
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';
