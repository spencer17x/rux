import { useEffect, useState } from "react";
import { Button, Checkbox, IconButton, Input, Menu, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, Modal, Popover, SegmentedControl, Select, Slider, Switch, Tab, TabPanel, Tabs, TabsList, Textarea } from "./index";
import { AppIcon, iconSizes, semanticIconNames, type IconName, type IconSize, type IconVariant } from "./icons";
import "./gallery.css";

const tokenNames = ["--rux-control-sm", "--rux-control-md", "--rux-control-lg", "--rux-radius-control", "--rux-radius-popup", "--rux-radius-panel", "--rux-space-1", "--rux-space-2", "--rux-space-3", "--rux-space-4", "--text", "--muted", "--surface", "--surface-selected", "--rux-focus"];

export default function ComponentGallery() {
  const [status, setStatus] = useState("可以直接操作这些组件，检查键盘、焦点和状态。");
  const [dialog, setDialog] = useState(false);
  const [alert, setAlert] = useState(false);
  const [name, setName] = useState("Rux 工作区");
  const [model, setModel] = useState("astra");
  const [details, setDetails] = useState(true);
  const [checked, setChecked] = useState(false);
  const [density, setDensity] = useState("comfortable");
  const [effort, setEffort] = useState(2);
  const [icon, setIcon] = useState<IconName>("conversation");
  const [iconSize, setIconSize] = useState<IconSize>("md");
  const [iconVariant, setIconVariant] = useState<IconVariant>("outline");
  const [tokens, setTokens] = useState<Record<string, string>>({});
  useEffect(() => { const style = getComputedStyle(document.documentElement); setTokens(Object.fromEntries(tokenNames.map((name) => [name, style.getPropertyValue(name).trim()]))); }, []);
  return <div className="ui-gallery">
    <header className="ui-gallery-header"><div><p>设计系统 / 开发预览</p><h1>Rux UI</h1><span>统一组件、图标与交互规则</span></div><a href="/?preview=signature">返回工作台</a></header>
    <Tabs defaultValue="components"><TabsList aria-label="组件展示内容"><Tab value="components">基础组件</Tab><Tab value="icons">图标</Tab><Tab value="tokens">设计变量</Tab></TabsList>
      <TabPanel value="components"><div className="ui-gallery-grid">
        <section><h2>按钮</h2><p>相同尺寸、语义变体和加载状态。</p><div className="ui-gallery-row"><Button variant="primary" onClick={() => setStatus("已触发主要操作")}>主要操作</Button><Button variant="secondary" onClick={() => setStatus("已触发次要操作")}>次要操作</Button><Button variant="ghost" onClick={() => setStatus("已触发轻量操作")}>轻量操作</Button><Button variant="danger" onClick={() => setAlert(true)}>危险操作</Button></div><div className="ui-gallery-row"><Button size="sm" variant="secondary">紧凑 28</Button><Button size="md" variant="secondary">标准 32</Button><Button size="lg" variant="secondary">宽松 40</Button></div><div className="ui-gallery-row"><Button disabled>不可用</Button><Button variant="primary" loading>保存中</Button><IconButton icon="search" label="搜索示例" onClick={() => setStatus("搜索图标已点击")} /><IconButton icon="settings" label="设置示例" active /><IconButton icon="delete" label="删除不可用" disabled /></div></section>
        <section><h2>输入与选择</h2><div className="ui-gallery-fields"><label>工作区名称<Input aria-label="工作区名称" value={name} onChange={(event) => setName(event.target.value)} /></label><label>默认模型<Select aria-label="组件示例模型" value={model} onValueChange={setModel} options={[{ value: "astra", label: "GPT-6 Astra" }, { value: "sol", label: "GPT-5.6 Sol" }, { value: "unavailable", label: "不可用模型", disabled: true }]} /></label><label>错误示例<Input aria-label="错误示例" aria-describedby="gallery-error-description" invalid defaultValue="需要修正的内容" /><small id="gallery-error-description" className="error-text">请检查输入内容。</small></label><label>说明<Textarea aria-label="说明" placeholder="输入说明…" /></label></div></section>
        <section><h2>开关与选项</h2><div className="ui-gallery-setting"><label htmlFor="gallery-details">显示详细统计</label><Switch id="gallery-details" checked={details} onCheckedChange={setDetails} /></div><label className="ui-gallery-setting"><span>保存为默认配置</span><Checkbox checked={checked} onCheckedChange={(value) => setChecked(value === true)} /></label><SegmentedControl label="工作区密度" value={density} onValueChange={setDensity} options={[{ value: "compact", label: "紧凑" }, { value: "comfortable", label: "宽松" }]} /><label className="ui-gallery-slider">思考强度：{["低", "中", "高", "极高"][effort]}<Slider aria-label="示例思考强度" min={0} max={3} value={effort} onChange={(event) => setEffort(Number(event.target.value))} /></label></section>
        <section><h2>菜单与弹窗</h2><p>支持方向键、Escape、焦点恢复和边界定位。</p><div className="ui-gallery-row"><Menu label="示例菜单" trigger={<Button variant="secondary">打开菜单<AppIcon name="caretDown" size="xs" /></Button>}><MenuItem onSelect={() => setStatus("已选择复制摘要")}><AppIcon name="copy" />复制摘要</MenuItem><MenuItem disabled>暂不可用</MenuItem><MenuSeparator /><MenuRadioGroup value={density} onValueChange={setDensity}><MenuRadioItem value="compact">紧凑</MenuRadioItem><MenuRadioItem value="comfortable">宽松</MenuRadioItem></MenuRadioGroup><MenuSeparator /><MenuItem danger onSelect={() => setAlert(true)}>删除示例</MenuItem></Menu><Popover label="示例浮层" trigger={<Button variant="secondary">打开浮层</Button>}><div className="ui-gallery-popover"><strong>组件提示</strong><p>点击外部关闭；新焦点会留在你选择的控件上。</p><Input aria-label="浮层输入" placeholder="试试键盘输入" /></div></Popover><Button variant="secondary" onClick={() => setDialog(true)}>打开对话框</Button></div></section>
      </div><p className="ui-gallery-status" role="status">{status}</p></TabPanel>
      <TabPanel value="icons"><section className="ui-gallery-icon-controls"><h2>图标语义表</h2><p>业务通过统一入口使用 Phosphor；尺寸与线条变体由组件控制。</p><div className="ui-gallery-row"><Select aria-label="图标尺寸" value={iconSize} onValueChange={(value) => setIconSize(value as IconSize)} options={Object.entries(iconSizes).map(([value, pixels]) => ({ value, label: `${value} · ${pixels}px` }))} /><SegmentedControl label="图标变体" value={iconVariant} onValueChange={(value) => setIconVariant(value as IconVariant)} options={[{ value: "outline", label: "线性" }, { value: "solid", label: "实心" }, { value: "strong", label: "强调" }]} /></div><div className="ui-gallery-icons">{semanticIconNames.map((name) => <Button key={name} variant="plain" className="ui-gallery-icon" active={icon === name} onClick={() => setIcon(name)}><AppIcon name={name} size={iconSize} variant={iconVariant} /><code>{name}</code></Button>)}</div><p role="status">当前图标：{icon}</p></section></TabPanel>
      <TabPanel value="tokens"><section><h2>单一设计变量来源</h2><p>以下数值读取当前主题，组件和展示页使用同一份变量。</p><dl className="ui-gallery-tokens">{tokenNames.map((name) => <div key={name}><dt>{name}</dt><dd>{tokens[name]}</dd></div>)}</dl></section></TabPanel>
    </Tabs>
    <Modal label="示例对话框" open={dialog} onClose={() => setDialog(false)} className="ui-gallery-modal"><div className="modal-header"><h2>示例对话框</h2><p>焦点会进入名称输入框，关闭后返回触发按钮。</p></div><label className="field-label">名称<Input data-autofocus aria-label="对话框名称" value={name} onChange={(event) => setName(event.target.value)} /></label><div className="modal-footer"><Button variant="secondary" onClick={() => setDialog(false)}>取消</Button><Button variant="primary" onClick={() => { setStatus(`已保存：${name}`); setDialog(false); }}>保存示例</Button></div></Modal>
    <Modal alert label="删除示例项目？" open={alert} onClose={() => setAlert(false)} className="ui-gallery-modal"><div className="modal-header"><h2>删除示例项目？</h2><p>这是组件演示，不会删除任何真实项目或文件。</p></div><div className="modal-footer"><Button data-autofocus variant="secondary" onClick={() => setAlert(false)}>取消</Button><Button variant="danger" onClick={() => { setStatus("删除示例已确认；真实文件未改动"); setAlert(false); }}>确认删除示例</Button></div></Modal>
  </div>;
}
