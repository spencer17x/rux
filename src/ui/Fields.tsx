import { forwardRef, useId, type ComponentPropsWithoutRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Checkbox as RadixCheckbox, Select as RadixSelect, Switch as RadixSwitch, Tabs as RadixTabs, ToggleGroup } from "radix-ui";
import { AppIcon } from "./icons";
import type { ControlSize } from "./Button";

export const Input = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: ControlSize; invalid?: boolean }>(function Input({ size = "md", invalid, className = "", ...props }, ref) {
  return <input ref={ref} {...props} aria-invalid={invalid || props["aria-invalid"]} data-size={size} className={`ui-input ${className}`} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ invalid, className = "", ...props }, ref) {
  return <textarea ref={ref} {...props} aria-invalid={invalid || props["aria-invalid"]} className={`ui-textarea ${className}`} />;
});
export const Slider = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(function Slider({ className = "", ...props }, ref) {
  return <input ref={ref} {...props} type="range" className={`ui-slider ${className}`} />;
});

type SelectOption = { value: string; label: string; disabled?: boolean };
type SelectProps = { value: string; onValueChange: (value: string) => void; options: SelectOption[]; placeholder?: string; disabled?: boolean; id?: string; name?: string; "aria-label"?: string; "aria-labelledby"?: string; className?: string; size?: ControlSize };
export function Select({ value, onValueChange, options, placeholder = "请选择", disabled, id, name, className = "", size = "md", ...aria }: SelectProps) {
  const empty = `empty-${useId()}`;
  const encoded = (value: string) => value || empty;
  return <RadixSelect.Root name={name} value={encoded(value)} onValueChange={(value) => onValueChange(value === empty ? "" : value)} disabled={disabled}><RadixSelect.Trigger {...aria} id={id} className={`ui-select ${className}`} data-size={size}><RadixSelect.Value placeholder={placeholder} /><RadixSelect.Icon><AppIcon name="caretDown" size="xs" /></RadixSelect.Icon></RadixSelect.Trigger><RadixSelect.Portal><RadixSelect.Content className="ui-select-content" position="popper" sideOffset={6} collisionPadding={8}><RadixSelect.ScrollUpButton className="ui-select-scroll"><AppIcon name="arrowUp" size="xs" /></RadixSelect.ScrollUpButton><RadixSelect.Viewport className="ui-select-viewport">{options.map((option) => <RadixSelect.Item className="ui-select-item" value={encoded(option.value)} key={option.value} disabled={option.disabled}><RadixSelect.ItemText>{option.label}</RadixSelect.ItemText><RadixSelect.ItemIndicator><AppIcon name="check" size="sm" /></RadixSelect.ItemIndicator></RadixSelect.Item>)}</RadixSelect.Viewport><RadixSelect.ScrollDownButton className="ui-select-scroll"><AppIcon name="arrowDown" size="xs" /></RadixSelect.ScrollDownButton></RadixSelect.Content></RadixSelect.Portal></RadixSelect.Root>;
}

export const Switch = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof RadixSwitch.Root>>(function Switch({ className = "", ...props }, ref) {
  return <RadixSwitch.Root ref={ref} {...props} className={`ui-switch ${className}`}><RadixSwitch.Thumb className="ui-switch-thumb" /></RadixSwitch.Root>;
});
export const Checkbox = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof RadixCheckbox.Root>>(function Checkbox({ className = "", ...props }, ref) {
  return <RadixCheckbox.Root ref={ref} {...props} className={`ui-checkbox ${className}`}><RadixCheckbox.Indicator><AppIcon name="check" size="sm" /></RadixCheckbox.Indicator></RadixCheckbox.Root>;
});
export function SegmentedControl({ value, onValueChange, options, label, disabled }: { value: string; onValueChange: (value: string) => void; options: Array<{ value: string; label: string }>; label: string; disabled?: boolean }) {
  return <ToggleGroup.Root type="single" value={value} onValueChange={(value) => { if (value) onValueChange(value); }} aria-label={label} disabled={disabled} className="ui-segmented">{options.map((option) => <ToggleGroup.Item key={option.value} value={option.value} className="ui-segment">{option.label}</ToggleGroup.Item>)}</ToggleGroup.Root>;
}
export function Tabs({ className = "", ...props }: ComponentPropsWithoutRef<typeof RadixTabs.Root>) { return <RadixTabs.Root {...props} className={`ui-tabs ${className}`} />; }
export function TabsList({ className = "", ...props }: ComponentPropsWithoutRef<typeof RadixTabs.List>) { return <RadixTabs.List {...props} className={`ui-tabs-list ${className}`} />; }
export function Tab({ className = "", ...props }: ComponentPropsWithoutRef<typeof RadixTabs.Trigger>) { return <RadixTabs.Trigger {...props} className={`ui-tab ${className}`} />; }
export function TabPanel({ className = "", ...props }: ComponentPropsWithoutRef<typeof RadixTabs.Content>) { return <RadixTabs.Content {...props} className={`ui-tab-panel ${className}`} />; }
