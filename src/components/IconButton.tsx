import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> & {
  label: string; active?: boolean; children: ReactNode;
};

export default function IconButton({ label, active = false, className = "", children, ...props }: Props) {
  return <button {...props} className={`icon-button ${active ? "is-active" : ""} ${className}`} type="button" aria-label={label} title={label}>{children}</button>;
}
