import { tv } from "tailwind-variants";

export const title = tv({
  base: "tracking-tight text-balance inline font-semibold text-foreground",
  variants: {
    color: {
      primary: "text-primary",
      secondary: "text-secondary",
      foreground: "text-foreground",
    },
    size: {
      sm: "text-2xl sm:text-3xl leading-tight",
      md: "text-3xl sm:text-4xl leading-tight",
      lg: "text-4xl sm:text-5xl leading-tight",
    },
    fullWidth: {
      true: "w-full block",
    },
  },
  defaultVariants: {
    size: "md",
    color: "foreground",
  },
  compoundVariants: [],
});
