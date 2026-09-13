import { forwardRef, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from "react";
import { Slot, Tooltip as RadixTooltip } from "radix-ui";
import { AppIcon, type IconName, type IconVariant, type IconSize } from "./icons";

export type ControlSize = "sm" | "md" | "lg" | "xl";
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "plain";
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ControlSize;
  active?: boolean;
  loading?: boolean;
  asChild?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "ghost", size = "md", active, loading = false, disabled, asChild, className = "", children, type = "button", onClick, onClickCapture, ...props }, ref) {
  const Component = asChild ? Slot.Root : "button";
  const inactive = disabled || loading;
  return <Component ref={ref} {...props} type={asChild ? undefined : type} disabled={asChild ? undefined : inactive} aria-disabled={asChild && inactive ? true : props["aria-disabled"]} tabIndex={asChild && inactive ? -1 : props.tabIndex} aria-busy={loading || undefined} onClickCapture={(event) => { if (inactive) { event.preventDefault(); event.stopPropagation(); return; } onClickCapture?.(event); }} onClick={(event) => { if (inactive) { event.preventDefault(); event.stopPropagation(); return; } onClick?.(event); }} data-variant={variant} data-size={size} data-active={active || undefined} className={`ui-button ${className}`}>
    {asChild ? children : <>{loading && <AppIcon name="circleNotch" size="sm" className="ui-spin" />}{children}</>}
  </Component>;
});

export function Tooltip({ content, children, disabled = false }: { content: ReactNode; children: ReactElement; disabled?: boolean }) {
  if (disabled || !content) return children;
  return <RadixTooltip.Provider delayDuration={500}><RadixTooltip.Root><RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger><RadixTooltip.Portal><RadixTooltip.Content className="ui-tooltip" sideOffset={6} collisionPadding={8}>{content}</RadixTooltip.Content></RadixTooltip.Portal></RadixTooltip.Root></RadixTooltip.Provider>;
}

export type IconButtonProps = Omit<ButtonProps, "title"> & { label: string; icon?: IconName; iconSize?: IconSize; iconVariant?: IconVariant; shape?: "square" | "round"; tooltip?: boolean; children?: ReactNode };
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, icon, iconSize, iconVariant = "outline", shape = "square", tooltip = true, active, size = "sm", className = "", children, ...props }, ref) {
  const button = <Button ref={ref} aria-label={label} {...props} data-shape={shape} size={size} active={active} className={`ui-icon-button icon-button ${active ? "is-active" : ""} ${className}`}>{icon ? <AppIcon name={icon} size={iconSize || (size === "sm" ? "sm" : size === "xl" ? "lg" : "md")} variant={iconVariant} /> : children}</Button>;
  return <Tooltip content={label} disabled={!tooltip || props.disabled || Boolean(props["aria-expanded"])}>{button}</Tooltip>;
});
