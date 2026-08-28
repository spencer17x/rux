import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> & {
  label: string; active?: boolean; children: ReactNode;
};

const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton({ label, active = false, className = "", children, ...props }, ref) {
  return <button ref={ref} {...props} className={`icon-button ${active ? "is-active" : ""} ${className}`} type="button" aria-label={label} title={label}>{children}</button>;
});

export default IconButton;
