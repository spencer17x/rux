import { HandPalm } from "@phosphor-icons/react";
import assistedApprovalShield from "../assets/assisted-approval-shield.png?no-inline";
import fullAccessWarningShield from "../assets/full-access-warning-shield.png?no-inline";

export type PermissionMode = "read-only" | "workspace-write" | "danger-full-access";

export default function PermissionModeIcon({ mode, size = 20 }: { mode: PermissionMode; size?: number }) {
  if (mode === "read-only") return <HandPalm size={size} />;
  if (mode === "danger-full-access") return <img className="permission-mode-icon" src={fullAccessWarningShield} width={size} height={size} alt="" aria-hidden="true" />;
  return <img className="permission-mode-icon" src={assistedApprovalShield} width={size} height={size} alt="" aria-hidden="true" />;
}
