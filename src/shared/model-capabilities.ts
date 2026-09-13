export type InputModality = "text" | "image";
export type ImageCapability = "supported" | "unsupported" | "unknown";

export function imageCapability(model?: { inputModalities?: readonly string[] }): ImageCapability {
  if (!model?.inputModalities) return "unknown";
  return model.inputModalities.includes("image") ? "supported" : "unsupported";
}

export function isImagePath(path: string): boolean { return /\.(png|jpe?g|gif|webp)$/i.test(path); }
export function imageCapabilityMessage(capability: ImageCapability): string { return capability === "supported" ? "" : capability === "unsupported" ? "当前模型不支持图片，请移除图片或切换支持图片的模型" : "尚未确认当前模型的图片能力，请先在模型设置中配置或选择支持图片的模型"; }

export function assertImageCapability(paths: readonly string[], capability: ImageCapability): void {
  if (!paths.some(isImagePath) || capability === "supported") return;
  throw new Error(imageCapabilityMessage(capability));
}
