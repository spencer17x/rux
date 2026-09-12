import { useEffect, useRef, useState } from "react";
import { AppIcon, Button, IconButton, Modal } from "../ui";
import { userFacingError } from "../renderer/errors";
import "./attachments.css";

function Attachment({ path, onRemove }: { path: string; onRemove?: (path: string) => void }) {
  const name = path.split(/[\\/]/).pop() || "附件";
  const isImage = /\.(png|jpe?g|gif|webp)$/i.test(path);
  const card = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [nearby, setNearby] = useState(false);
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const shouldLoad = isImage && (nearby || open);

  useEffect(() => {
    if (!isImage || !card.current) return;
    if (typeof IntersectionObserver === "undefined") { setNearby(true); return; }
    const observer = new IntersectionObserver(([entry]) => setNearby(entry.isIntersecting), { rootMargin: "160px" });
    observer.observe(card.current);
    return () => observer.disconnect();
  }, [isImage]);

  useEffect(() => {
    // Release off-screen image data so a long conversation does not retain every full image.
    if (!shouldLoad) { setImage(""); return; }
    let cancelled = false;
    setError("");
    window.rux.system.previewImage({ path }).then((data) => {
      if (!cancelled) setImage(data);
    }).catch((error) => { if (!cancelled) setError(userFacingError(error)); });
    return () => { cancelled = true; };
  }, [path, shouldLoad, attempt]);

  const failed = () => { setImage(""); setError("图片无法解码，请重新添加"); };
  return <div ref={card} className={`attachment-item ${isImage ? "attachment-image" : "attachment-file"}`} title={path}>
    {isImage ? <Button variant="plain" className="attachment-open" aria-label={`预览图片 ${name}`} onClick={() => setOpen(true)}>
      <span className="attachment-thumbnail">{image ? <img src={image} alt={`图片附件 ${name}`} onError={failed} /> : <span className="attachment-image-state"><AppIcon name={error ? "warning" : "loading"} size="md" className={error ? "" : "ui-spin"} /><small>{error ? "预览不可用" : "加载中"}</small></span>}</span>
      <span className="attachment-name">{name}</span>
    </Button> : <span className="attachment-file-name"><AppIcon name="attachment" size="xs" /><span>{name}</span></span>}
    {onRemove && <IconButton className="attachment-remove" label={`移除附件 ${name}`} icon="close" tooltip={false} onClick={() => onRemove(path)} />}
    {isImage && <Modal label="图片预览" open={open} onClose={() => setOpen(false)} initialFocusRef={close} className="attachment-preview-modal">
      <div className="attachment-preview-header"><strong>{name}</strong><IconButton ref={close} label="关闭图片预览" icon="close" tooltip={false} onClick={() => setOpen(false)} /></div>
      <div className="attachment-preview-body">{image ? <img src={image} alt={`图片原图 ${name}`} onError={failed} /> : error ? <div className="attachment-preview-state" role="alert"><AppIcon name="warning" size="lg" /><p>{error}</p><Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>重试</Button></div> : <div className="attachment-preview-state" role="status"><AppIcon name="loading" className="ui-spin" size="lg" />正在加载图片…</div>}</div>
    </Modal>}
  </div>;
}

export default function AttachmentList({ paths, onRemove }: { paths: string[]; onRemove?: (path: string) => void }) {
  if (!paths.length) return null;
  return <div className="attachment-list" aria-label={onRemove ? "待发送附件" : "消息附件"}>{paths.map((path) => <Attachment key={path} path={path} onRemove={onRemove} />)}</div>;
}
