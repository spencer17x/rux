import { useEffect, useRef, type ComponentPropsWithoutRef, type ReactElement, type ReactNode, type RefObject } from "react";
import { Dialog as RadixDialog, DropdownMenu, Popover as RadixPopover, ContextMenu } from "radix-ui";
import { AppIcon } from "./icons";

type Placement = { side?: "top" | "bottom" | "left" | "right"; align?: "start" | "center" | "end" };
type PopupWidth = "sm" | "md" | "lg";
type PopupProps = Placement & { label: string; trigger: ReactElement; children: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void; className?: string };

// A menu can disappear while it opens a dialog or another picker. Returning
// focus to that old trigger would dismiss the newly opened layer.
const modalReturnTargets = new WeakMap<HTMLElement, HTMLElement>();
function transferFocus(anchor: HTMLElement | null, scope?: string): boolean {
  const modal = [...document.querySelectorAll<HTMLElement>('.ui-modal[data-state="open"]')].at(-1);
  if (modal && !modal.contains(anchor)) {
    if (anchor?.isConnected) modalReturnTargets.set(modal, anchor);
    return true;
  }
  return [...document.querySelectorAll<HTMLElement>('.ui-popover[data-state="open"]')].some((layer) => !scope || layer.dataset.overlayId !== scope);
}

export function Menu({ label, trigger, children, open, onOpenChange, side = "bottom", align = "end", className = "" }: PopupProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}><DropdownMenu.Trigger ref={triggerRef} asChild>{trigger}</DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content aria-label={label} aria-labelledby={undefined} className={`ui-menu ${className}`} side={side} align={align} sideOffset={6} collisionPadding={8} onCloseAutoFocus={(event) => { if (transferFocus(triggerRef.current)) event.preventDefault(); }}>{children}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>;
}

export function MenuItem({ danger = false, className = "", children, ...props }: ComponentPropsWithoutRef<typeof DropdownMenu.Item> & { danger?: boolean }) {
  return <DropdownMenu.Item {...props} className={`ui-menu-item ${className}`} data-danger={danger || undefined}>{children}</DropdownMenu.Item>;
}
export function MenuRadioItem({ className = "", children, ...props }: ComponentPropsWithoutRef<typeof DropdownMenu.RadioItem>) {
  return <DropdownMenu.RadioItem {...props} className={`ui-menu-item ui-menu-radio-item ${className}`}><span>{children}</span><DropdownMenu.ItemIndicator><AppIcon name="check" size="sm" /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>;
}
export const MenuRadioGroup = DropdownMenu.RadioGroup;
export const MenuGroup = DropdownMenu.Group;
export function MenuLabel({ children }: { children: ReactNode }) { return <DropdownMenu.Label className="ui-menu-label">{children}</DropdownMenu.Label>; }
export function MenuSeparator() { return <DropdownMenu.Separator className="ui-menu-separator" />; }

export function ContextActions({ label, trigger, children }: { label: string; trigger: ReactElement; children: ReactNode }) {
  const returnTarget = useRef<HTMLElement | null>(null);
  return <ContextMenu.Root modal={false}><ContextMenu.Trigger asChild onContextMenu={(event) => { returnTarget.current = (event.target as Element).closest<HTMLElement>("button, [tabindex]") || event.currentTarget.querySelector<HTMLElement>("button, [tabindex]"); }}>{trigger}</ContextMenu.Trigger><ContextMenu.Portal><ContextMenu.Content aria-label={label} aria-labelledby={undefined} className="ui-menu" collisionPadding={8} onCloseAutoFocus={(event) => { if (transferFocus(returnTarget.current)) event.preventDefault(); }}>{children}</ContextMenu.Content></ContextMenu.Portal></ContextMenu.Root>;
}
export function ContextAction({ danger, className = "", ...props }: ComponentPropsWithoutRef<typeof ContextMenu.Item> & { danger?: boolean }) { return <ContextMenu.Item {...props} data-danger={danger || undefined} className={`ui-menu-item ${className}`} />; }

function focusPreferred(event: Event) {
  const root = event.currentTarget as HTMLElement | null;
  const target = root?.querySelector<HTMLElement>("[data-autofocus]:not(:disabled)") || root?.querySelector<HTMLElement>("[aria-checked='true']:not(:disabled), [aria-pressed='true']:not(:disabled)");
  if (target) { event.preventDefault(); target.focus({ preventScroll: true }); }
}

export function Popover({ label, trigger, children, open, onOpenChange, side = "top", align = "end", className = "" }: PopupProps) {
  return <RadixPopover.Root open={open} onOpenChange={onOpenChange}><RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger><RadixPopover.Portal><RadixPopover.Content aria-label={label} className={`ui-popover ui-popover-padded ${className}`} side={side} align={align} sideOffset={6} collisionPadding={8} onOpenAutoFocus={focusPreferred}>{children}</RadixPopover.Content></RadixPopover.Portal></RadixPopover.Root>;
}

/** For the composer, whose mutually exclusive popup triggers live in one toolbar. */
export function AnchoredPopover({ anchorRef, scope, children, onDismiss, align = "end", width = "sm" }: { anchorRef: RefObject<HTMLElement | null>; scope: string; children: ReactNode; onDismiss: () => void; align?: "start" | "end"; width?: PopupWidth }) {
  const outside = useRef(false);
  const escaped = useRef(false);
  return (
    <RadixPopover.Root open onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <RadixPopover.Anchor virtualRef={anchorRef as RefObject<HTMLElement>} />
      <RadixPopover.Portal>
        <RadixPopover.Content
          role="presentation"
          className="ui-popover"
          data-width={width}
          data-overlay-scope
          data-overlay-id={scope}
          side="top"
          align={align}
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={focusPreferred}
          onEscapeKeyDown={() => { escaped.current = true; }}
          onInteractOutside={(event) => {
            if (anchorRef.current?.contains(event.target as Node)) { event.preventDefault(); return; }
            outside.current = true;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!transferFocus(anchorRef.current, scope) && (escaped.current || !outside.current)) anchorRef.current?.focus({ preventScroll: true });
          }}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

type ModalProps = { label: string; children: ReactNode; open?: boolean; onClose: () => void; className?: string; initialFocusRef?: RefObject<HTMLElement | null>; focusKey?: string; busy?: boolean; alert?: boolean };
export function Modal({ label, children, open = true, onClose, className = "", initialFocusRef, focusKey, busy = false, alert = false }: ModalProps) {
  const opener = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const openedContent = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (open && focusKey) contentRef.current?.querySelector<HTMLElement>("[data-autofocus]:not(:disabled)")?.focus(); }, [open, focusKey]);
  const content = <><RadixDialog.Overlay className="ui-modal-overlay" /><RadixDialog.Content ref={contentRef} className={`ui-modal modal ${className}`} role={alert ? "alertdialog" : "dialog"} aria-label={label} aria-describedby={undefined} onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onOpenAutoFocus={(event) => { opener.current = document.activeElement as HTMLElement; openedContent.current = contentRef.current; if (initialFocusRef?.current) { event.preventDefault(); initialFocusRef.current.focus(); if (initialFocusRef.current instanceof HTMLInputElement) initialFocusRef.current.select(); } else focusPreferred(event); }} onCloseAutoFocus={(event) => { const target = (openedContent.current && modalReturnTargets.get(openedContent.current)) || opener.current; if (target?.isConnected) { event.preventDefault(); target.focus({ preventScroll: true }); } }}><RadixDialog.Title asChild><span className="sr-only">{label}</span></RadixDialog.Title>{children}</RadixDialog.Content></>;
  return <RadixDialog.Root open={open} onOpenChange={(value) => { if (!value && !busy) onClose(); }}>{typeof document === "undefined" ? content : <RadixDialog.Portal>{content}</RadixDialog.Portal>}</RadixDialog.Root>;
}
