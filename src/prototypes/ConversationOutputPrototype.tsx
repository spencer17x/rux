import { useEffect, useState } from "react";
import {
  ArrowUp, CaretDown, CaretRight, Check, CheckCircle, CircleNotch, Copy,
  FileText, Folder, GearSix, Globe, HandPalm, ListBullets, Microphone,
  Pause, ShareNetwork, SidebarSimple, Stop, TerminalWindow, ThumbsDown,
  ThumbsUp, XCircle,
} from "@phosphor-icons/react";
import "./conversation-output-prototype.css";

type DisclosureProps = {
  icon: "file" | "terminal" | "error";
  label: string;
  meta?: string;
  open: boolean;
  onToggle: () => void;
  tone?: "normal" | "error" | "running" | "success";
  children?: React.ReactNode;
};

function Disclosure({ icon, label, meta, open, onToggle, tone = "normal", children }: DisclosureProps) {
  const Icon = icon === "file" ? FileText : icon === "terminal" ? TerminalWindow : XCircle;
  return <section className={`prototype-tool ${tone} ${open ? "is-open" : ""}`}>
    <button type="button" className="prototype-tool-summary" onClick={onToggle} aria-expanded={open}>
      <Icon size={16} weight={tone === "error" ? "fill" : "regular"} />
      <span>{label}</span>{meta && <small>{meta}</small>}{open ? <CaretDown size={14} /> : <CaretRight size={14} />}
    </button>
    {open && <div className="prototype-tool-details">{children}</div>}
  </section>;
}

const streamWords = "如果你更重视阅读节奏，我会保留正文的连续性，只在必要的位置插入轻量工具摘要；所有命令、路径、输出和错误堆栈都在点击后展开。".split("");

export default function ConversationOutputPrototype() {
  const [readOpen, setReadOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [errorOpen, setErrorOpen] = useState(false);
  const [retryState, setRetryState] = useState<"idle" | "retrying" | "success">("idle");
  const [paused, setPaused] = useState(false);
  const [visibleChars, setVisibleChars] = useState(0);

  useEffect(() => {
    if (paused || visibleChars >= streamWords.length) return undefined;
    const timer = window.setTimeout(() => setVisibleChars((value) => value + 1), visibleChars < 12 ? 46 : 28);
    return () => window.clearTimeout(timer);
  }, [paused, visibleChars]);

  const retry = () => {
    if (retryState === "retrying") return;
    setRetryState("retrying");
    window.setTimeout(() => { setRetryState("success"); setErrorOpen(false); }, 1350);
  };

  const reset = () => { setReadOpen(false); setCommandOpen(false); setErrorOpen(false); setRetryState("idle"); setPaused(false); setVisibleChars(0); };

  return <main className={`conversation-prototype ${paused ? "is-paused" : ""}`}>
    <header className="prototype-topbar">
      <div className="prototype-project"><Folder size={18} /><span>rux-demo</span><i>/</i><strong>优化对话输出体验</strong><button type="button" aria-label="更多">•••</button></div>
      <div className="prototype-top-actions"><button type="button" aria-label="分享"><ShareNetwork size={17} /></button><button type="button" className="prototype-location">打开位置 <CaretDown size={13} /></button><button type="button" aria-label="环境信息"><ListBullets size={18} /></button><button type="button" aria-label="底部面板"><SidebarSimple size={18} /></button><button type="button" aria-label="侧栏"><SidebarSimple size={18} className="prototype-sidebar-icon" /></button><button type="button" aria-label="设置"><GearSix size={18} /></button></div>
    </header>

    <section className="prototype-thread">
      <time className="prototype-date">今天 10:18</time>
      <div className="prototype-user-wrap"><div className="prototype-user">把 Rux 的对话输出改得像 Codex 一样自然，工具细节默认折叠。</div><small>10:18 <Copy size={14} /></small></div>

      <section className="prototype-turn">
        <div className="prototype-processing"><span>{paused ? "已暂停" : retryState === "retrying" ? "正在重试" : "已处理 38秒"}</span>{!paused && visibleChars < streamWords.length && <i><b /><b /><b /></i>}</div>
        <div className="prototype-divider" />

        <div className="prototype-answer">
          <p>我会把正文放回视觉中心：稳定段落直接阅读，Agent 的过程只作为轻量脚注出现。</p>

          <Disclosure icon="file" label="读取 docs/agent-design-guide.md" meta="1.2秒" open={readOpen} onToggle={() => setReadOpen((value) => !value)}>
            <dl><div><dt>文件</dt><dd>docs/agent-design-guide.md</dd></div><div><dt>范围</dt><dd>1–284 行</dd></div></dl>
          </Disclosure>

          <p>当工具开始运行时，页面只增加一行摘要，不打断正文的行宽和阅读位置。用户需要证据时，再点击展开。</p>

          <Disclosure icon="terminal" label="运行 pnpm test" meta={paused ? "已暂停" : "18.4秒"} open={commandOpen} onToggle={() => setCommandOpen((value) => !value)} tone={paused ? "normal" : "running"}>
            <div className="prototype-command-head"><span><b>命令</b> pnpm test --filter=workbench</span><button type="button" aria-label="复制命令"><Copy size={14} /></button></div>
            <div className="prototype-command-meta"><span>工作目录</span><code>/Users/17a/projects/rux</code></div>
            <pre><span>&gt; vitest run</span>{"\n"}<span className="prototype-pass">✓ src/inline-footnotes/expand.test.ts (12 tests) 142ms</span>{"\n"}<span>Test Files  1 passed (1)</span>{"\n"}<span>Duration  18.21s</span></pre>
          </Disclosure>

          <Disclosure icon="error" label={retryState === "success" ? "测试失败后已重试成功" : retryState === "retrying" ? "正在重试失败的测试" : "测试失败 · 1 个错误"} meta={retryState === "success" ? "已恢复" : "2.1秒"} open={errorOpen} onToggle={() => setErrorOpen((value) => !value)} tone={retryState === "success" ? "success" : retryState === "retrying" ? "running" : "error"}>
            <div className="prototype-error-detail"><strong>{retryState === "retrying" ? "正在重新运行失败用例…" : "命令执行失败"}</strong><p>测试用例期望返回的模型列表不为空。</p><div><button type="button">查看详情</button><button type="button" className="prototype-retry" onClick={retry}>{retryState === "retrying" ? <><CircleNotch size={14} className="prototype-spin" />重试中</> : "重试"}</button></div></div>
          </Disclosure>

          {retryState === "success" && <div className="prototype-resumed"><CheckCircle size={14} weight="fill" />已从失败处继续</div>}

          <p>基于工具结果，我会继续给出结论，不要求用户在“正文”和“执行面板”之间来回切换。</p>
          <p className="prototype-streaming"><span>{streamWords.slice(0, visibleChars).join("")}</span>{visibleChars < streamWords.length && <i />}</p>
        </div>

        <footer className="prototype-turn-footer"><button type="button">用时 38秒 <CaretRight size={13} /></button><span /><button type="button" aria-label="复制回答"><Copy size={15} /></button><button type="button" aria-label="赞"><ThumbsUp size={15} /></button><button type="button" aria-label="踩"><ThumbsDown size={15} /></button></footer>
      </section>
    </section>

    <section className="prototype-composer">
      <span className="prototype-placeholder">向 Rux 发送消息</span>
      <div className="prototype-composer-row"><div><button type="button" aria-label="添加">＋</button><button type="button" aria-label="联网"><Globe size={17} /></button><button type="button" className="prototype-permission"><HandPalm size={16} />请求批准 <CaretDown size={12} /></button></div><div><button type="button" className="prototype-model">Codex <CaretDown size={12} /></button><button type="button" className="prototype-model">默认 <CaretDown size={12} /></button><button type="button" className="prototype-model">GPT-5.6 Sol <CaretDown size={12} /></button><button type="button" className="prototype-model">中 <CaretDown size={12} /></button><button type="button" aria-label="语音"><Microphone size={17} /></button>{paused ? <><button type="button" className="prototype-stop" onClick={reset}><Stop size={13} weight="fill" />结束</button><button type="button" className="prototype-continue" onClick={() => setPaused(false)}>继续</button></> : <button type="button" className="prototype-pause" onClick={() => setPaused(true)}><Pause size={14} weight="fill" />暂停</button>}<button type="button" className="prototype-send" aria-label="发送"><ArrowUp size={17} weight="bold" /></button></div></div>
    </section>

    <button type="button" className="prototype-replay" onClick={reset}>重播演示</button>
  </main>;
}
