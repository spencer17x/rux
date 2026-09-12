import { HandPalm } from "../ui/icons";
import { iconPixels, type IconSize } from "../ui/icons";
import assistedApprovalShield from "../assets/assisted-approval-shield.png?no-inline";
import fullAccessWarningShield from "../assets/full-access-warning-shield.png?no-inline";

export type PermissionMode = "read-only" | "workspace-write" | "danger-full-access";

export default function PermissionModeIcon({ mode, size = "md" }: { mode: PermissionMode; size?: IconSize | number }) {
  const pixels = iconPixels(size);
  if (mode === "read-only") return <HandPalm size={size} />;
  if (mode === "danger-full-access") return <img className="permission-mode-icon" src={fullAccessWarningShield} width={pixels} height={pixels} alt="" aria-hidden="true" />;
  return <img className="permission-mode-icon" src={assistedApprovalShield} width={pixels} height={pixels} alt="" aria-hidden="true" />;
}
