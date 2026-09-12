import { forwardRef, type ComponentType, type SVGProps } from "react";
import { ArrowCounterClockwise as PhosphorArrowCounterClockwise, ArrowDown as PhosphorArrowDown, ArrowLeft as PhosphorArrowLeft, ArrowSquareOut as PhosphorArrowSquareOut, ArrowUp as PhosphorArrowUp, ArrowsClockwise as PhosphorArrowsClockwise, CaretDown as PhosphorCaretDown, CaretLeft as PhosphorCaretLeft, CaretRight as PhosphorCaretRight, ChatCircle as PhosphorChatCircle, Check as PhosphorCheck, CheckCircle as PhosphorCheckCircle, CircleNotch as PhosphorCircleNotch, Code as PhosphorCode, Copy as PhosphorCopy, Cpu as PhosphorCpu, Cube as PhosphorCube, DotsThree as PhosphorDotsThree, DownloadSimple as PhosphorDownloadSimple, Eye as PhosphorEye, File as PhosphorFile, FileText as PhosphorFileText, Folder as PhosphorFolder, FolderOpen as PhosphorFolderOpen, FolderPlus as PhosphorFolderPlus, GearSix as PhosphorGearSix, GitBranch as PhosphorGitBranch, GitCommit as PhosphorGitCommit, GitDiff as PhosphorGitDiff, GithubLogo as PhosphorGithubLogo, Globe as PhosphorGlobe, HandPalm as PhosphorHandPalm, HardDrive as PhosphorHardDrive, Info as PhosphorInfo, Keyboard as PhosphorKeyboard, Lightning as PhosphorLightning, ListBullets as PhosphorListBullets, LockKey as PhosphorLockKey, MagnifyingGlass as PhosphorMagnifyingGlass, Microphone as PhosphorMicrophone, Monitor as PhosphorMonitor, OpenAiLogo as PhosphorOpenAiLogo, Palette as PhosphorPalette, Paperclip as PhosphorPaperclip, Pause as PhosphorPause, PencilSimple as PhosphorPencilSimple, Plus as PhosphorPlus, Robot as PhosphorRobot, ShareNetwork as PhosphorShareNetwork, SidebarSimple as PhosphorSidebarSimple, SlidersHorizontal as PhosphorSlidersHorizontal, Sparkle as PhosphorSparkle, Stop as PhosphorStop, TerminalWindow as PhosphorTerminalWindow, ThumbsDown as PhosphorThumbsDown, ThumbsUp as PhosphorThumbsUp, Trash as PhosphorTrash, WarningCircle as PhosphorWarningCircle, Wrench as PhosphorWrench, X as PhosphorX, XCircle as PhosphorXCircle } from "@phosphor-icons/react";

export const iconSizes = { xs: 12, sm: 16, md: 20, lg: 24, xl: 32 } as const;
export type IconSize = keyof typeof iconSizes;
export type IconVariant = "outline" | "solid" | "strong";
export type AppIconProps = Omit<SVGProps<SVGSVGElement>, "width" | "height" | "size"> & { name: IconName; size?: IconSize | number; variant?: IconVariant; label?: string };
export type IconProps = Omit<AppIconProps, "name">;
export type Icon = ComponentType<IconProps>;

const glyphMap = {
  arrowCounterClockwise: PhosphorArrowCounterClockwise,
  arrowDown: PhosphorArrowDown,
  arrowLeft: PhosphorArrowLeft,
  arrowSquareOut: PhosphorArrowSquareOut,
  arrowUp: PhosphorArrowUp,
  arrowsClockwise: PhosphorArrowsClockwise,
  caretDown: PhosphorCaretDown,
  caretLeft: PhosphorCaretLeft,
  caretRight: PhosphorCaretRight,
  chatCircle: PhosphorChatCircle,
  check: PhosphorCheck,
  checkCircle: PhosphorCheckCircle,
  circleNotch: PhosphorCircleNotch,
  code: PhosphorCode,
  copy: PhosphorCopy,
  cpu: PhosphorCpu,
  cube: PhosphorCube,
  dotsThree: PhosphorDotsThree,
  downloadSimple: PhosphorDownloadSimple,
  eye: PhosphorEye,
  file: PhosphorFile,
  fileText: PhosphorFileText,
  folder: PhosphorFolder,
  folderOpen: PhosphorFolderOpen,
  folderPlus: PhosphorFolderPlus,
  gearSix: PhosphorGearSix,
  gitBranch: PhosphorGitBranch,
  gitCommit: PhosphorGitCommit,
  gitDiff: PhosphorGitDiff,
  githubLogo: PhosphorGithubLogo,
  globe: PhosphorGlobe,
  handPalm: PhosphorHandPalm,
  hardDrive: PhosphorHardDrive,
  info: PhosphorInfo,
  keyboard: PhosphorKeyboard,
  lightning: PhosphorLightning,
  listBullets: PhosphorListBullets,
  lockKey: PhosphorLockKey,
  magnifyingGlass: PhosphorMagnifyingGlass,
  microphone: PhosphorMicrophone,
  monitor: PhosphorMonitor,
  openAiLogo: PhosphorOpenAiLogo,
  palette: PhosphorPalette,
  paperclip: PhosphorPaperclip,
  pause: PhosphorPause,
  pencilSimple: PhosphorPencilSimple,
  plus: PhosphorPlus,
  robot: PhosphorRobot,
  shareNetwork: PhosphorShareNetwork,
  sidebarSimple: PhosphorSidebarSimple,
  slidersHorizontal: PhosphorSlidersHorizontal,
  sparkle: PhosphorSparkle,
  stop: PhosphorStop,
  terminalWindow: PhosphorTerminalWindow,
  thumbsDown: PhosphorThumbsDown,
  thumbsUp: PhosphorThumbsUp,
  trash: PhosphorTrash,
  warningCircle: PhosphorWarningCircle,
  wrench: PhosphorWrench,
  x: PhosphorX,
  xCircle: PhosphorXCircle,
} as const;
export const iconMap = { ...glyphMap,
  add: glyphMap.plus,
  close: glyphMap.x,
  search: glyphMap.magnifyingGlass,
  settings: glyphMap.gearSix,
  more: glyphMap.dotsThree,
  edit: glyphMap.pencilSimple,
  delete: glyphMap.trash,
  project: glyphMap.folder,
  conversation: glyphMap.chatCircle,
  attachment: glyphMap.paperclip,
  model: glyphMap.cube,
  permissions: glyphMap.handPalm,
  review: glyphMap.gitDiff,
  terminal: glyphMap.terminalWindow,
  browser: glyphMap.globe,
  loading: glyphMap.circleNotch,
  refresh: glyphMap.arrowsClockwise,
  back: glyphMap.arrowLeft,
  send: glyphMap.arrowUp,
  success: glyphMap.checkCircle,
  warning: glyphMap.warningCircle,
} as const;
export const semanticIconNames = ["add", "close", "search", "settings", "more", "edit", "delete", "project", "conversation", "attachment", "model", "permissions", "review", "terminal", "browser", "loading", "refresh", "back", "send", "success", "warning"] as const;
export type IconName = keyof typeof iconMap;

/** Pixels are accepted only at compatibility boundaries such as raster assets. */
export function iconPixels(size: IconSize | number = "sm"): number {
  if (typeof size !== "number") return iconSizes[size];
  return size <= 13 ? 12 : size <= 17 ? 16 : size <= 22 ? 20 : size <= 27 ? 24 : 32;
}

export const AppIcon = forwardRef<SVGSVGElement, AppIconProps>(function AppIcon({ name, size = "sm", variant = "outline", label, className = "", style, ...props }, ref) {
  const Glyph = iconMap[name];
  const pixels = iconPixels(size);
  return <Glyph ref={ref} aria-hidden={label ? undefined : true} aria-label={label} role={label ? "img" : undefined} focusable="false" {...props} className={`ui-icon ${className}`} data-icon={name} size={pixels} weight={variant === "solid" ? "fill" : variant === "strong" ? "bold" : "regular"} style={{ ...style, width: pixels, height: pixels, flexShrink: 0 }} />;
});

function defineIcon(name: IconName) {
  const Glyph = forwardRef<SVGSVGElement, IconProps>((props, ref) => <AppIcon ref={ref} name={name} {...props} />);
  Glyph.displayName = `RuxIcon(${name})`;
  return Glyph;
}

export const ArrowCounterClockwise = defineIcon("arrowCounterClockwise");
export const ArrowDown = defineIcon("arrowDown");
export const ArrowLeft = defineIcon("back");
export const ArrowSquareOut = defineIcon("arrowSquareOut");
export const ArrowUp = defineIcon("send");
export const ArrowsClockwise = defineIcon("refresh");
export const CaretDown = defineIcon("caretDown");
export const CaretLeft = defineIcon("caretLeft");
export const CaretRight = defineIcon("caretRight");
export const ChatCircle = defineIcon("conversation");
export const Check = defineIcon("check");
export const CheckCircle = defineIcon("success");
export const CircleNotch = defineIcon("loading");
export const Code = defineIcon("code");
export const Copy = defineIcon("copy");
export const Cube = defineIcon("model");
export const DotsThree = defineIcon("more");
export const DownloadSimple = defineIcon("downloadSimple");
export const Eye = defineIcon("eye");
export const File = defineIcon("file");
export const FileText = defineIcon("fileText");
export const Folder = defineIcon("project");
export const FolderOpen = defineIcon("folderOpen");
export const FolderPlus = defineIcon("folderPlus");
export const GearSix = defineIcon("settings");
export const GitBranch = defineIcon("gitBranch");
export const GitCommit = defineIcon("gitCommit");
export const GitDiff = defineIcon("review");
export const GithubLogo = defineIcon("githubLogo");
export const Globe = defineIcon("browser");
export const HandPalm = defineIcon("permissions");
export const HardDrive = defineIcon("hardDrive");
export const Info = defineIcon("info");
export const Keyboard = defineIcon("keyboard");
export const Lightning = defineIcon("lightning");
export const ListBullets = defineIcon("listBullets");
export const LockKey = defineIcon("lockKey");
export const MagnifyingGlass = defineIcon("search");
export const Microphone = defineIcon("microphone");
export const Monitor = defineIcon("monitor");
export const OpenAiLogo = defineIcon("openAiLogo");
export const Palette = defineIcon("palette");
export const Paperclip = defineIcon("attachment");
export const Pause = defineIcon("pause");
export const PencilSimple = defineIcon("edit");
export const Plus = defineIcon("add");
export const Robot = defineIcon("robot");
export const ShareNetwork = defineIcon("shareNetwork");
export const SidebarSimple = defineIcon("sidebarSimple");
export const SlidersHorizontal = defineIcon("slidersHorizontal");
export const Sparkle = defineIcon("sparkle");
export const Stop = defineIcon("stop");
export const TerminalWindow = defineIcon("terminal");
export const ThumbsDown = defineIcon("thumbsDown");
export const ThumbsUp = defineIcon("thumbsUp");
export const Trash = defineIcon("delete");
export const WarningCircle = defineIcon("warning");
export const Wrench = defineIcon("wrench");
export const X = defineIcon("close");
export const XCircle = defineIcon("xCircle");
